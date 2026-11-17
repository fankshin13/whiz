-- 이미 가입된 운전자를 차량에 직접 배정(결정 2026-11-17: 같은 조직의 미배정 활성 운전자만, 사유는 감사 로그).
-- 지금까지는 초대 링크(신규 가입)로만 배정되어 재배정은 SQL 로 해야 했다.

alter type public.audit_action_type add value if not exists 'VEHICLE_DRIVER_ASSIGN';

-- 한 운전자는 차량 하나에만 배정(앱은 배정 차량 하나를 기준으로 동작). 기존 데이터에 중복이 있으면 만들지 않고 알린다.
do $$
begin
  if exists (select assigned_user_id from public.vehicles where assigned_user_id is not null group by 1 having count(*) > 1) then
    raise notice '한 운전자가 여러 차량에 배정된 데이터가 있어 uq_vehicles_assigned_user 를 만들지 않았습니다. 정리 후 다시 실행하세요.';
  else
    create unique index uq_vehicles_assigned_user on public.vehicles (assigned_user_id) where assigned_user_id is not null;
  end if;
end $$;

-- 감사 트리거: 배정(없음 → 운전자)을 따로 구분
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
        when v_changed = array['assigned_user_id'] and v_old -> 'assigned_user_id' = 'null'::jsonb then 'VEHICLE_DRIVER_ASSIGN'
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



create function public.assign_driver(p_vehicle_id uuid, p_user_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.user_role := private.current_user_role();
  v_org uuid := private.current_user_org_id();
  v_vehicle public.vehicles%rowtype;
  v_user public.users%rowtype;
begin
  if (select auth.uid()) is null or v_role is null or v_role not in ('super_admin', 'org_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_vehicle from public.vehicles where id = p_vehicle_id for update;
  if not found or (v_role = 'org_admin' and v_vehicle.org_id is distinct from v_org) then
    raise exception 'VEHICLE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_vehicle.assigned_user_id is not null then
    raise exception 'VEHICLE_ASSIGNED' using errcode = 'P0001';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found or v_user.org_id is distinct from v_vehicle.org_id or v_user.role <> 'driver' or not v_user.is_active then
    raise exception 'DRIVER_NOT_ELIGIBLE' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.vehicles where assigned_user_id = p_user_id) then
    raise exception 'DRIVER_ASSIGNED' using errcode = 'P0001';
  end if;
  -- 이 차량에 대기 중인 초대가 있으면 먼저 취소하게 한다(두 사람이 같은 차량을 받는 일 방지)
  if exists (select 1 from public.invitations i
             where i.vehicle_id = p_vehicle_id and i.used_at is null and i.revoked_at is null and i.expires_at > now()) then
    raise exception 'PENDING_INVITATION' using errcode = 'P0001';
  end if;

  perform set_config('pedaleye.audit_reason', left(coalesce(trim(p_reason), ''), 200), true);
  update public.vehicles set assigned_user_id = p_user_id where id = p_vehicle_id;
  perform set_config('pedaleye.audit_reason', '', true);
  return jsonb_build_object('vehicle_id', p_vehicle_id, 'user_id', p_user_id);
end;
$$;
revoke execute on function public.assign_driver(uuid, uuid, text) from public, anon;
grant execute on function public.assign_driver(uuid, uuid, text) to authenticated;
