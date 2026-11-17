-- 단말 인증 공개키(Ed25519, 32바이트)를 서버에 등록한다(docs/ble-protocol.md 4장).
-- 운전자 앱은 배정 단말의 공개키로 단말 서명을 확인한다. 공개키는 비밀이 아니지만 바꿔치기되면 가짜 단말을 믿게 되므로
-- 등록·교체·해제는 슈퍼 관리자만, 교체·해제는 사유와 함께 감사 로그에 남긴다.

-- 감사 작업 종류 추가는 별도 트랜잭션이 필요 없도록 맨 앞에서 한다(아래 함수는 문자열로만 참조)
alter type public.audit_action_type add value if not exists 'DEVICE_KEY_REGISTER';
alter type public.audit_action_type add value if not exists 'DEVICE_KEY_UPDATE';
alter type public.audit_action_type add value if not exists 'DEVICE_KEY_REVOKE';

-- 저장 형식: 표준 Base64 44자(끝 '=' 하나) = 정확히 32바이트
alter table public.devices add column auth_public_key text;
alter table public.devices
  add constraint chk_devices_auth_public_key_format
  check (auth_public_key is null or auth_public_key ~ '^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$');

-- 소속 조직·일련번호·인증 공개키는 슈퍼 관리자(또는 서버 내부 작업)만 바꾼다. 운전자는 보정값만.
create or replace function private.guard_device_driver_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or private.current_user_role() = 'super_admin'::public.user_role then
    return new;
  end if;
  if private.current_user_role() = 'driver'::public.user_role
     and (new.serial_number is distinct from old.serial_number
          or new.mac_address is distinct from old.mac_address
          or new.vehicle_id is distinct from old.vehicle_id
          or new.org_id is distinct from old.org_id
          or new.auth_public_key is distinct from old.auth_public_key
          or new.hardware_rev is distinct from old.hardware_rev
          or new.firmware_version is distinct from old.firmware_version
          or new.last_synced_at is distinct from old.last_synced_at
          or new.created_at is distinct from old.created_at) then
    raise exception '운전자는 페달 보정값만 수정할 수 있습니다.' using errcode = '42501';
  end if;
  if new.org_id is distinct from old.org_id or new.serial_number is distinct from old.serial_number
     or new.auth_public_key is distinct from old.auth_public_key then
    raise exception '단말의 소속 조직·일련번호·인증 공개키는 슈퍼 관리자만 변경할 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 감사 트리거: 공개키 등록·교체·해제를 따로 구분
create or replace function private.audit_log_trigger_fn()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then private.audit_row(to_jsonb(old)) else null end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then private.audit_row(to_jsonb(new)) else null end;
  v_row jsonb := coalesce(v_new, v_old);
  v_actor uuid := (select auth.uid());
  v_hint text := nullif(current_setting('pedaleye.audit_action', true), '');
  v_reason text := nullif(current_setting('pedaleye.audit_reason', true), '');
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
        when 'auth_public_key' = any (v_changed) and v_new -> 'auth_public_key' = 'null'::jsonb then 'DEVICE_KEY_REVOKE'
        when 'auth_public_key' = any (v_changed) and v_old -> 'auth_public_key' = 'null'::jsonb then 'DEVICE_KEY_REGISTER'
        when 'auth_public_key' = any (v_changed) then 'DEVICE_KEY_UPDATE'
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
               else jsonb_build_object('before', v_before, 'after', v_after) end
      || case when v_reason is not null then jsonb_build_object('reason', v_reason) else '{}'::jsonb end,
    'SUCCESS');
  return null;
end;
$$;


-- 공개키 교체·해제(슈퍼 관리자 전용, 사유 필수). 새 키가 null 이면 해제(시험 단말로 전환).
create function public.set_device_public_key(p_device_id uuid, p_public_key text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_old text;
begin
  if (select auth.uid()) is null or private.current_user_role() is distinct from 'super_admin' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 2 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  select auth_public_key into v_old from public.devices where id = p_device_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old is not distinct from p_public_key then
    return jsonb_build_object('changed', false);
  end if;
  perform set_config('pedaleye.audit_reason', left(trim(p_reason), 200), true);
  update public.devices set auth_public_key = p_public_key where id = p_device_id; -- 형식은 CHECK 제약이 검사
  perform set_config('pedaleye.audit_reason', '', true);
  return jsonb_build_object('changed', true);
end;
$$;
revoke execute on function public.set_device_public_key(uuid, text, text) from public, anon;
grant execute on function public.set_device_public_key(uuid, text, text) to authenticated;
