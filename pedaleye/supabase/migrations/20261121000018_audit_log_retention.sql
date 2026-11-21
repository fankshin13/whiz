-- 감사 로그 보존: 1년(365일) 보관 후, 아카이브(CSV, 비공개 저장소)를 먼저 남긴 기록만 삭제한다.
-- 순서: 서버가 대상 행으로 CSV 를 만들어 저장소에 올림 → register_audit_archive 가 건수·행 지문을 DB 에서 다시 계산해 등록
--       → purge_archived_audit_logs 가 지문을 한 번 더 확인한 뒤에만 삭제. 두 함수 모두 서버(service_role) 전용.
-- 수정(UPDATE)·TRUNCATE 금지는 그대로이고, DELETE 도 이 함수 안에서 365일이 지난 행만 허용한다.

alter type public.audit_action_type add value if not exists 'AUDIT_ARCHIVE';
alter type public.audit_action_type add value if not exists 'AUDIT_PURGE';
alter type public.audit_action_type add value if not exists 'AUDIT_ARCHIVE_DOWNLOAD';

-- 1) 아카이브 기록
create table public.audit_log_archives (
  id uuid primary key default gen_random_uuid(),
  cutoff timestamptz not null,               -- 이 시각 이전 기록 전부를 담는다
  oldest_at timestamptz not null,
  newest_at timestamptz not null,
  row_count integer not null check (row_count > 0),
  rows_digest text not null,                 -- 대상 행 ID 목록의 SHA-256(DB 계산)
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size integer not null check (file_size > 0),
  storage_path text not null unique,
  created_by uuid,                           -- null = 자동 실행
  created_at timestamptz not null default now(),
  purged_at timestamptz,
  purged_count integer
);
create index idx_audit_log_archives_created on public.audit_log_archives (created_at desc);

alter table public.audit_log_archives enable row level security;
revoke all on public.audit_log_archives from public, anon, authenticated;
grant select on public.audit_log_archives to authenticated;
create policy audit_log_archives_select on public.audit_log_archives
  for select to authenticated
  using ((select private.current_user_role()) = 'super_admin');

-- 아카이브 기록도 지울 수 없고, 삭제 완료 표시(purged_at·purged_count)만 삭제 함수 안에서 한 번 쓸 수 있다
create function private.prevent_audit_archive_tampering()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and current_setting('pedaleye.audit_purge', true) = 'on'
     and old.purged_at is null and new.purged_at is not null
     and (to_jsonb(new) - 'purged_at' - 'purged_count') = (to_jsonb(old) - 'purged_at' - 'purged_count') then
    return new;
  end if;
  raise exception 'audit_log_archives 기록은 수정하거나 삭제할 수 없습니다.' using errcode = '42501';
end;
$$;
revoke execute on function private.prevent_audit_archive_tampering() from public, anon, authenticated;

create trigger trg_audit_archives_immutable before update or delete on public.audit_log_archives
  for each row execute function private.prevent_audit_archive_tampering();
create trigger trg_audit_archives_no_truncate before truncate on public.audit_log_archives
  for each statement execute function private.prevent_audit_archive_tampering();

-- 2) 감사 로그 불변 규칙: 삭제 함수가 켠 표시가 있고 365일이 지난 행만 DELETE 허용
create or replace function private.prevent_audit_logs_tampering()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('pedaleye.audit_purge', true) = 'on'
     and old.created_at < now() - interval '365 days' then
    return old;
  end if;
  raise exception 'audit_logs 기록은 수정하거나 삭제할 수 없습니다.' using errcode = '42501';
end;
$$;

-- 3) 아카이브 파일 저장소(비공개, 정책 없음 = service_role 만 접근)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audit-archives', 'audit-archives', false, 52428800, array['text/csv'])
on conflict (id) do nothing;

-- 4) 대상 행(cutoff 이전) 건수와 ID 지문
create function private.audit_rows_before(p_cutoff timestamptz, out row_count integer, out rows_digest text,
                                          out oldest_at timestamptz, out newest_at timestamptz)
language sql stable set search_path = ''
as $$
  select count(*)::integer,
         encode(sha256(convert_to(coalesce(string_agg(id::text, ',' order by id), ''), 'UTF8')), 'hex'),
         min(created_at), max(created_at)
  from public.audit_logs
  where created_at < p_cutoff;
$$;
revoke execute on function private.audit_rows_before(timestamptz) from public, anon, authenticated;

create function private.assert_retention_cutoff(p_cutoff timestamptz)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if p_cutoff is null or p_cutoff > now() - interval '365 days' then
    raise exception 'RETENTION_NOT_REACHED' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function private.assert_retention_cutoff(timestamptz) from public, anon, authenticated;

-- 5) 아카이브 등록: 서버가 올린 CSV 의 건수가 DB 의 대상 건수와 같아야 한다
create function public.register_audit_archive(
  p_cutoff timestamptz,
  p_row_count integer,
  p_file_sha256 text,
  p_file_size integer,
  p_storage_path text,
  p_actor_id uuid default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_rows record;
  v_id uuid;
begin
  perform private.assert_retention_cutoff(p_cutoff);
  -- 동시에 두 번 실행되지 않게 한다(자동 실행과 수동 실행이 겹칠 때)
  perform pg_advisory_xact_lock(hashtext('pedaleye.audit_retention'));

  select * into v_rows from private.audit_rows_before(p_cutoff);
  if v_rows.row_count = 0 then
    raise exception 'NOTHING_TO_ARCHIVE' using errcode = 'P0001';
  end if;
  if v_rows.row_count <> p_row_count then
    raise exception 'ARCHIVE_MISMATCH' using errcode = 'P0001';
  end if;

  insert into public.audit_log_archives (cutoff, oldest_at, newest_at, row_count, rows_digest, file_sha256, file_size,
                                         storage_path, created_by)
  values (p_cutoff, v_rows.oldest_at, v_rows.newest_at, v_rows.row_count, v_rows.rows_digest, lower(p_file_sha256),
          p_file_size, p_storage_path, p_actor_id)
  returning id into v_id;

  perform private.audit_insert(p_actor_id, null, 'AUDIT_ARCHIVE', 'audit_archive', v_id::text, p_storage_path,
    jsonb_build_object('cutoff', p_cutoff, 'row_count', v_rows.row_count, 'file_sha256', lower(p_file_sha256),
                       'mode', case when p_actor_id is null then 'auto' else 'manual' end),
    'SUCCESS');
  return v_id;
end;
$$;
revoke execute on function public.register_audit_archive(timestamptz, integer, text, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.register_audit_archive(timestamptz, integer, text, integer, text, uuid) to service_role;

-- 6) 삭제: 아카이브 이후 대상 행이 하나라도 달라졌으면(지문 불일치) 거부
create function public.purge_archived_audit_logs(p_archive_id uuid, p_actor_id uuid default null)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_archive public.audit_log_archives%rowtype;
  v_rows record;
  v_deleted integer;
begin
  perform pg_advisory_xact_lock(hashtext('pedaleye.audit_retention'));
  select * into v_archive from public.audit_log_archives where id = p_archive_id for update;
  if not found then
    raise exception 'ARCHIVE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_archive.purged_at is not null then
    raise exception 'ALREADY_PURGED' using errcode = 'P0001';
  end if;
  perform private.assert_retention_cutoff(v_archive.cutoff);

  select * into v_rows from private.audit_rows_before(v_archive.cutoff);
  if v_rows.row_count <> v_archive.row_count or v_rows.rows_digest <> v_archive.rows_digest then
    raise exception 'ARCHIVE_MISMATCH' using errcode = 'P0001';
  end if;

  perform set_config('pedaleye.audit_purge', 'on', true);
  delete from public.audit_logs where created_at < v_archive.cutoff;
  get diagnostics v_deleted = row_count;
  update public.audit_log_archives set purged_at = now(), purged_count = v_deleted where id = v_archive.id;
  perform set_config('pedaleye.audit_purge', 'off', true);

  perform private.audit_insert(p_actor_id, null, 'AUDIT_PURGE', 'audit_archive', v_archive.id::text, v_archive.storage_path,
    jsonb_build_object('cutoff', v_archive.cutoff, 'deleted_count', v_deleted, 'file_sha256', v_archive.file_sha256,
                       'mode', case when p_actor_id is null then 'auto' else 'manual' end),
    'SUCCESS');
  return v_deleted;
end;
$$;
revoke execute on function public.purge_archived_audit_logs(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_archived_audit_logs(uuid, uuid) to service_role;

-- 7) 아카이브 파일 내려받기 기록(서버가 슈퍼 관리자 확인 후 호출)
create function public.record_audit_archive_download(p_archive_id uuid, p_actor_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_path text;
begin
  select storage_path into v_path from public.audit_log_archives where id = p_archive_id;
  if v_path is null then
    raise exception 'ARCHIVE_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.audit_insert(p_actor_id, null, 'AUDIT_ARCHIVE_DOWNLOAD', 'audit_archive', p_archive_id::text, v_path,
    '{}'::jsonb, 'SUCCESS');
end;
$$;
revoke execute on function public.record_audit_archive_download(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_audit_archive_download(uuid, uuid) to service_role;
