-- 관리 작업 감사 로그(ISMS-P 접근·변경 기록). 추가만 가능하고 누구도 수정·삭제할 수 없다.
-- 변경 작업은 테이블 트리거가 자동 기록(앱을 거치지 않은 수정도 남음), 보고서 열람·권한 거부는 서버가 log_admin_audit_event 로 기록.

create type public.audit_action_type as enum (
  'ORG_CREATE', 'ORG_UPDATE', 'ORG_DELETE',
  'VEHICLE_CREATE', 'VEHICLE_UPDATE', 'VEHICLE_DRIVER_UNASSIGN', 'VEHICLE_DELETE',
  'DEVICE_CREATE', 'DEVICE_MOUNT', 'DEVICE_REPLACE', 'DEVICE_UNMOUNT', 'DEVICE_CALIBRATE', 'DEVICE_UPDATE', 'DEVICE_DELETE',
  'INVITATION_CREATE', 'INVITATION_ACCEPT', 'INVITATION_CANCEL', 'INVITATION_DELETE',
  'USER_DEACTIVATE', 'USER_REACTIVATE', 'USER_ROLE_CHANGE',
  'REPORT_VIEW', 'REPORT_DOWNLOAD'
);
create type public.audit_status as enum ('SUCCESS', 'DENIED');

-- 외래 키를 두지 않는다: 로그는 대상(사용자·조직)이 지워져도 그대로 남아야 하고,
-- ON DELETE SET NULL 은 로그 UPDATE 가 되어 불변 트리거에 막힌다.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  actor_id uuid,
  actor_name text not null,
  actor_role public.user_role, -- null = 시스템(서버 내부 작업)
  action_type public.audit_action_type not null,
  target_type text not null,
  target_id text not null,
  target_display_name text not null,
  changes_summary jsonb not null default '{}'::jsonb,
  status public.audit_status not null default 'SUCCESS',
  ip_address text not null default 'UNKNOWN',
  created_at timestamptz not null default now()
);

create index idx_audit_logs_org_created on public.audit_logs (org_id, created_at desc);
create index idx_audit_logs_created_at on public.audit_logs (created_at desc);
create index idx_audit_logs_action_type on public.audit_logs (action_type);
create index idx_audit_logs_actor_id on public.audit_logs (actor_id);

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from public, anon, authenticated;
grant select on public.audit_logs to authenticated;

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin' and org_id = (select private.current_user_org_id()))
  );

-- 불변: UPDATE·DELETE·TRUNCATE 모두 거부(서비스 키·슈퍼 관리자 포함)
create function private.prevent_audit_logs_tampering()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'audit_logs 기록은 수정하거나 삭제할 수 없습니다.' using errcode = '42501';
end;
$$;
revoke execute on function private.prevent_audit_logs_tampering() from public, anon, authenticated;

create trigger trg_audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function private.prevent_audit_logs_tampering();
create trigger trg_audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.prevent_audit_logs_tampering();

-- 요청 IP: 웹 서버가 실제 접속자 IP 를 x-pedaleye-client-ip 로 넘긴다. 없으면 PostgREST 가 받은 x-forwarded-for 첫 값.
create function private.audit_request_ip()
returns text
language plpgsql stable set search_path = ''
as $$
declare
  v_headers jsonb;
  v_ip text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip := coalesce(v_headers ->> 'x-pedaleye-client-ip', split_part(v_headers ->> 'x-forwarded-for', ',', 1));
  v_ip := left(trim(coalesce(v_ip, '')), 64);
  return coalesce(nullif(v_ip, ''), 'UNKNOWN');
end;
$$;
revoke execute on function private.audit_request_ip() from public, anon, authenticated;

-- 이메일은 앞 1글자와 도메인만 남긴다(개인정보 최소화)
create function private.audit_mask_email(p_email text)
returns text
language sql immutable set search_path = ''
as $$
  select case when p_email is null or position('@' in p_email) = 0 then p_email
              else left(p_email, 1) || '***' || substring(p_email from position('@' in p_email)) end;
$$;
revoke execute on function private.audit_mask_email(text) from public, anon, authenticated;

-- 행을 감사용 요약으로 바꾼다: 비밀값은 가리고, 이메일은 마스킹, 자동 갱신 열은 뺀다
create function private.audit_row(p_row jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(key,
           case when key in ('token_hash', 'password', 'encrypted_password', 'secret', 'api_key') then '"***REDACTED***"'::jsonb
                when key = 'email' then to_jsonb(private.audit_mask_email(value #>> '{}'))
                else value end), '{}'::jsonb)
  from jsonb_each(p_row)
  where key not in ('updated_at', 'created_at');
$$;
revoke execute on function private.audit_row(jsonb) from public, anon, authenticated;

create function private.audit_insert(
  p_actor_id uuid, p_org_id uuid, p_action public.audit_action_type, p_target_type text, p_target_id text,
  p_target_name text, p_changes jsonb, p_status public.audit_status
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
  v_role public.user_role;
  v_id uuid;
begin
  if p_actor_id is not null then
    select u.name, u.role into v_name, v_role from public.users u where u.id = p_actor_id;
  end if;
  insert into public.audit_logs (org_id, actor_id, actor_name, actor_role, action_type, target_type, target_id,
                                 target_display_name, changes_summary, status, ip_address)
  values (p_org_id, p_actor_id, coalesce(v_name, case when p_actor_id is null then '시스템' else '알 수 없는 사용자' end), v_role,
          p_action, p_target_type, p_target_id, coalesce(nullif(p_target_name, ''), p_target_id),
          coalesce(p_changes, '{}'::jsonb), p_status, private.audit_request_ip())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function private.audit_insert(uuid, uuid, public.audit_action_type, text, text, text, jsonb, public.audit_status)
  from public, anon, authenticated;

-- 변경 자동 기록
create function private.audit_log_trigger_fn()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then private.audit_row(to_jsonb(old)) else null end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then private.audit_row(to_jsonb(new)) else null end;
  v_row jsonb := coalesce(v_new, v_old);
  v_actor uuid := (select auth.uid());
  v_hint text := nullif(current_setting('pedaleye.audit_action', true), '');
  v_action public.audit_action_type;
  v_changed text[];
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_target_type text;
  v_name text;
  v_org uuid;
  k text;
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key), '{}') into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from v_old -> n.key;
    if cardinality(v_changed) = 0 then
      return null;
    end if;
    foreach k in array v_changed loop
      v_before := v_before || jsonb_build_object(k, v_old -> k);
      v_after := v_after || jsonb_build_object(k, v_new -> k);
    end loop;
  end if;

  case tg_table_name
    when 'organizations' then
      v_target_type := 'organization';
      v_org := (v_row ->> 'id')::uuid;
      v_name := v_row ->> 'name';
      v_action := case tg_op when 'INSERT' then 'ORG_CREATE' when 'UPDATE' then 'ORG_UPDATE' else 'ORG_DELETE' end;
    when 'vehicles' then
      v_target_type := 'vehicle';
      v_org := (v_row ->> 'org_id')::uuid;
      v_name := v_row ->> 'plate_number';
      v_action := case
        when tg_op = 'INSERT' then 'VEHICLE_CREATE'
        when tg_op = 'DELETE' then 'VEHICLE_DELETE'
        when v_changed = array['assigned_user_id'] and v_new -> 'assigned_user_id' = 'null'::jsonb then 'VEHICLE_DRIVER_UNASSIGN'
        else 'VEHICLE_UPDATE' end;
    when 'devices' then
      v_target_type := 'device';
      v_org := (v_row ->> 'org_id')::uuid;
      v_name := v_row ->> 'serial_number';
      -- 업로드 때마다 바뀌는 동기화 시각만 바뀐 경우는 관리 작업이 아니므로 남기지 않는다
      if tg_op = 'UPDATE' and v_changed <@ array['last_synced_at'] then
        return null;
      end if;
      v_action := case
        when tg_op = 'INSERT' then 'DEVICE_CREATE'
        when tg_op = 'DELETE' then 'DEVICE_DELETE'
        when 'vehicle_id' = any (v_changed) and v_hint = 'DEVICE_REPLACE' then 'DEVICE_REPLACE'
        when 'vehicle_id' = any (v_changed) and v_new -> 'vehicle_id' = 'null'::jsonb then 'DEVICE_UNMOUNT'
        when 'vehicle_id' = any (v_changed) then 'DEVICE_MOUNT'
        when v_changed <@ array['accel_calib_min', 'accel_calib_max', 'brake_calib_min', 'brake_calib_max'] then 'DEVICE_CALIBRATE'
        else 'DEVICE_UPDATE' end;
    when 'invitations' then
      v_target_type := 'invitation';
      v_org := (v_row ->> 'org_id')::uuid;
      v_name := v_row ->> 'invitee_name';
      v_action := case
        when tg_op = 'INSERT' then 'INVITATION_CREATE'
        when tg_op = 'DELETE' then 'INVITATION_DELETE'
        when 'used_at' = any (v_changed) and v_new -> 'used_at' <> 'null'::jsonb then 'INVITATION_ACCEPT'
        when 'revoked_at' = any (v_changed) then 'INVITATION_CANCEL'
        else null end;
      -- 초대 수락은 서버 내부 작업이므로 수락한 사용자를 수행자로 남긴다
      if v_action = 'INVITATION_ACCEPT' and v_actor is null then
        v_actor := nullif(v_new ->> 'accepted_user_id', '')::uuid;
      end if;
    when 'users' then
      v_target_type := 'user';
      v_org := (v_row ->> 'org_id')::uuid;
      v_name := v_row ->> 'name';
      -- 가입(INSERT)은 초대 수락 기록에 포함되고, 이름 등 일반 정보 변경은 남기지 않는다
      v_action := case
        when tg_op <> 'UPDATE' then null
        when 'is_active' = any (v_changed) and v_new -> 'is_active' = 'false'::jsonb then 'USER_DEACTIVATE'
        when 'is_active' = any (v_changed) then 'USER_REACTIVATE'
        when 'role' = any (v_changed) or 'org_id' = any (v_changed) then 'USER_ROLE_CHANGE'
        else null end;
    else
      v_action := null;
  end case;

  if v_action is null then
    return null;
  end if;

  perform private.audit_insert(
    v_actor, v_org, v_action, v_target_type, v_row ->> 'id', v_name,
    case tg_op when 'INSERT' then jsonb_build_object('after', v_new)
               when 'DELETE' then jsonb_build_object('before', v_old)
               else jsonb_build_object('before', v_before, 'after', v_after) end,
    'SUCCESS');
  return null;
end;
$$;
revoke execute on function private.audit_log_trigger_fn() from public, anon, authenticated;

create trigger trg_audit_organizations after insert or update or delete on public.organizations
  for each row execute function private.audit_log_trigger_fn();
create trigger trg_audit_vehicles after insert or update or delete on public.vehicles
  for each row execute function private.audit_log_trigger_fn();
create trigger trg_audit_devices after insert or update or delete on public.devices
  for each row execute function private.audit_log_trigger_fn();
create trigger trg_audit_invitations after insert or update or delete on public.invitations
  for each row execute function private.audit_log_trigger_fn();
create trigger trg_audit_users after update on public.users
  for each row execute function private.audit_log_trigger_fn();

-- 서버가 남기는 기록(보고서 열람·출력, 권한 거부). 수행자는 인자로 받지 않고 로그인 세션(auth.uid())으로 정한다(위조 방지).
-- 변경 작업의 성공 기록은 트리거만 남길 수 있다.
create function public.log_admin_audit_event(
  p_action_type public.audit_action_type,
  p_target_type text,
  p_target_id text,
  p_target_display_name text default null,
  p_changes_summary jsonb default '{}'::jsonb,
  p_status public.audit_status default 'SUCCESS'
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
begin
  if v_actor is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_action_type not in ('REPORT_VIEW', 'REPORT_DOWNLOAD') and p_status <> 'DENIED' then
    raise exception 'INVALID_AUDIT_EVENT' using errcode = '22023';
  end if;
  if length(coalesce(p_target_type, '')) not between 1 and 40 or length(coalesce(p_target_id, '')) not between 1 and 100 then
    raise exception 'INVALID_AUDIT_EVENT' using errcode = '22023';
  end if;

  -- 보고서는 세션이 속한 차량의 조직, 그 밖에는 수행자의 조직으로 묶는다
  if p_target_type = 'event_report' and p_target_id ~ '^[0-9a-fA-F-]{36}$' then
    select coalesce(v.org_id, d.org_id) into v_org
    from public.event_sessions s
    join public.devices d on d.id = s.device_id
    left join public.vehicles v on v.id = d.vehicle_id
    where s.id = p_target_id::uuid;
  end if;
  v_org := coalesce(v_org, (select u.org_id from public.users u where u.id = v_actor));

  return private.audit_insert(v_actor, v_org, p_action_type, p_target_type, p_target_id,
                              left(coalesce(p_target_display_name, ''), 200),
                              private.audit_row(coalesce(p_changes_summary, '{}'::jsonb)), p_status);
end;
$$;
revoke execute on function public.log_admin_audit_event(public.audit_action_type, text, text, text, jsonb, public.audit_status) from public, anon;
grant execute on function public.log_admin_audit_event(public.audit_action_type, text, text, text, jsonb, public.audit_status) to authenticated;

-- 교체 장착은 '해제 + 장착' 두 행 변경이 함께 일어나므로 둘 다 DEVICE_REPLACE 로 남기도록 표시한다(트랜잭션 안에서만 유효).
create or replace function public.mount_device(p_device_id uuid, p_vehicle_id uuid, p_replace boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.user_role := private.current_user_role();
  v_org uuid := private.current_user_org_id();
  v_vehicle public.vehicles%rowtype;
  v_device public.devices%rowtype;
  v_current public.devices%rowtype;
begin
  if (select auth.uid()) is null or v_role is null or v_role not in ('super_admin', 'org_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_vehicle from public.vehicles where id = p_vehicle_id for update;
  if not found or (v_role = 'org_admin' and v_vehicle.org_id is distinct from v_org) then
    raise exception 'VEHICLE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_device from public.devices where id = p_device_id for update;
  if not found or (v_role = 'org_admin' and v_device.org_id is distinct from v_org) then
    raise exception 'DEVICE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_device.vehicle_id = p_vehicle_id then
    return jsonb_build_object('device_id', v_device.id, 'replaced_device_id', null, 'replaced_serial', null);
  end if;
  if v_device.vehicle_id is not null then
    raise exception 'DEVICE_MOUNTED_ELSEWHERE' using errcode = 'P0001';
  end if;

  select * into v_current from public.devices where vehicle_id = p_vehicle_id for update;
  if found then
    if not p_replace then
      raise exception 'VEHICLE_HAS_DEVICE' using errcode = 'P0001';
    end if;
    perform set_config('pedaleye.audit_action', 'DEVICE_REPLACE', true);
    update public.devices set vehicle_id = null where id = v_current.id;
  end if;

  update public.devices
     set vehicle_id = p_vehicle_id,
         org_id = v_vehicle.org_id,
         accel_calib_min = 0, accel_calib_max = 4095,
         brake_calib_min = 0, brake_calib_max = 4095
   where id = v_device.id;
  perform set_config('pedaleye.audit_action', '', true);

  return jsonb_build_object(
    'device_id', v_device.id,
    'replaced_device_id', v_current.id,
    'replaced_serial', v_current.serial_number
  );
end;
$$;
