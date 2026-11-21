-- 보관 기간 자동 파기(결정 2026-11-21, CPO).
--  - 계정: 비활성화 후 1년이 지나면 익명화(로그인 계정 무력화, 이름·이메일을 되돌릴 수 없는 값으로 교체, 내부 ID 만 남김)
--  - 사고 기록: 생성 후 3년이 지나면 파기. 슈퍼 관리자가 '법적 보존'을 표시한 기록은 제외(해제하면 다음 실행에서 파기)
--  - 매월 자동 실행(서버 service_role). 파기·익명화 건수는 감사 로그에 남긴다.

alter type public.audit_action_type add value if not exists 'USER_ANONYMIZE';
alter type public.audit_action_type add value if not exists 'EVENT_PURGE';
alter type public.audit_action_type add value if not exists 'EVENT_LEGAL_HOLD';
alter type public.audit_action_type add value if not exists 'EVENT_LEGAL_HOLD_RELEASE';

alter table public.users add column anonymized_at timestamptz;

alter table public.event_sessions
  add column legal_hold boolean not null default false,
  add column legal_hold_reason text,
  add column legal_hold_at timestamptz,
  add column legal_hold_by uuid,
  add constraint chk_event_sessions_legal_hold check (not legal_hold or (legal_hold_reason is not null and legal_hold_at is not null));

create index idx_event_sessions_created_at on public.event_sessions (created_at);

-- 1) 계정 익명화
create function public.anonymize_expired_accounts()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_placeholder text;
begin
  perform pg_advisory_xact_lock(hashtext('pedaleye.record_retention'));
  select coalesce(array_agg(id), '{}') into v_ids
  from public.users
  where not is_active and anonymized_at is null and deactivated_at < now() - interval '365 days';
  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  perform set_config('pedaleye.user_admin', 'on', true);
  foreach v_id in array v_ids loop
    v_placeholder := 'deleted+' || v_id::text || '@invalid.pedaleye';
    -- 받은 초대에 남은 이름·이메일도 함께 지운다
    update public.invitations set invitee_name = '삭제된 사용자', email = v_placeholder where accepted_user_id = v_id;
    update public.users set name = '삭제된 사용자', email = v_placeholder, anonymized_at = now() where id = v_id;
    -- 로그인 계정 무력화: 이메일·비밀번호·프로필 제거, 연결된 로그인 수단과 세션 삭제
    update auth.users
       set email = v_placeholder, encrypted_password = '', raw_user_meta_data = '{}'::jsonb, phone = null,
           email_change = '', banned_until = now() + interval '100 years'
     where id = v_id;
    delete from auth.identities where user_id = v_id;
    delete from auth.sessions where user_id = v_id;
  end loop;
  perform set_config('pedaleye.user_admin', '', true);

  perform private.audit_insert(null, null, 'USER_ANONYMIZE', 'user', 'retention', '보관 기간(비활성화 후 1년) 경과 계정',
    jsonb_build_object('count', cardinality(v_ids), 'user_ids', to_jsonb(v_ids)), 'SUCCESS');
  return cardinality(v_ids);
end;
$$;
revoke execute on function public.anonymize_expired_accounts() from public, anon, authenticated;
grant execute on function public.anonymize_expired_accounts() to service_role;

-- 2) 사고 기록 파기 대상(서버가 저장소 파일을 먼저 지우고, 아래 함수로 행을 지운다)
create function public.list_expired_event_sessions(p_limit integer default 200)
returns table (id uuid, raw_log_storage_path text)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.raw_log_storage_path
  from public.event_sessions s
  where s.created_at < now() - interval '3 years' and not s.legal_hold
  order by s.created_at
  limit least(greatest(p_limit, 1), 1000);
$$;
revoke execute on function public.list_expired_event_sessions(integer) from public, anon, authenticated;
grant execute on function public.list_expired_event_sessions(integer) to service_role;

create function public.purge_event_sessions(p_ids uuid[])
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_deleted uuid[];
begin
  perform pg_advisory_xact_lock(hashtext('pedaleye.record_retention'));
  -- 넘겨받은 목록이어도 지금 기준으로 다시 확인한다(그사이 보존 표시된 기록은 남김)
  with gone as (
    delete from public.event_sessions
     where id = any (p_ids) and created_at < now() - interval '3 years' and not legal_hold
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_deleted from gone;

  if cardinality(v_deleted) > 0 then
    perform private.audit_insert(null, null, 'EVENT_PURGE', 'event_report', 'retention', '보관 기간(생성 후 3년) 경과 사고 기록',
      jsonb_build_object('count', cardinality(v_deleted), 'session_ids', to_jsonb(v_deleted)), 'SUCCESS');
  end if;
  return cardinality(v_deleted);
end;
$$;
revoke execute on function public.purge_event_sessions(uuid[]) from public, anon, authenticated;
grant execute on function public.purge_event_sessions(uuid[]) to service_role;

-- 3) 법적 보존 표시·해제(슈퍼 관리자, 사유 필수)
create function public.set_event_legal_hold(p_session_id uuid, p_hold boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_session public.event_sessions%rowtype;
  v_org uuid;
  v_reason text := left(nullif(trim(coalesce(p_reason, '')), ''), 200);
begin
  if (select auth.uid()) is null or private.current_user_role() is distinct from 'super_admin'::public.user_role then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_hold and v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v_session from public.event_sessions where id = p_session_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_session.legal_hold = p_hold then
    return;
  end if;

  update public.event_sessions
     set legal_hold = p_hold,
         legal_hold_reason = case when p_hold then v_reason else null end,
         legal_hold_at = case when p_hold then now() else null end,
         legal_hold_by = case when p_hold then (select auth.uid()) else null end
   where id = p_session_id;

  select coalesce(v.org_id, d.org_id) into v_org
  from public.devices d left join public.vehicles v on v.id = d.vehicle_id
  where d.id = v_session.device_id;

  perform private.audit_insert((select auth.uid()), v_org,
    case when p_hold then 'EVENT_LEGAL_HOLD' else 'EVENT_LEGAL_HOLD_RELEASE' end::public.audit_action_type,
    'event_report', p_session_id::text, to_char(v_session.start_time at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
    case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end, 'SUCCESS');
end;
$$;
revoke execute on function public.set_event_legal_hold(uuid, boolean, text) from public, anon;
grant execute on function public.set_event_legal_hold(uuid, boolean, text) to authenticated;
