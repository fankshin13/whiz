-- 사용자 계정 비활성화·재활성화(결정 2026-11-17: 삭제 없이 비활성화만).
-- 비활성 계정은 권한 함수가 null 을 돌려 모든 RLS 에서 즉시 차단된다(이미 발급된 토큰 포함).
-- 같은 트랜잭션에서 로그인도 막는다(auth.users.banned_until, 기존 세션·갱신 토큰 삭제). 서버 키가 필요 없다.

alter table public.users
  add column is_active boolean not null default true,
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references public.users (id) on delete set null;

create index idx_users_org_active on public.users (org_id, is_active);

create or replace function private.current_user_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select u.role from public.users u where u.id = (select auth.uid()) and u.is_active;
$$;

create or replace function private.current_user_org_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select u.org_id from public.users u where u.id = (select auth.uid()) and u.is_active;
$$;

-- 역할·조직·이메일·활성 상태는 슈퍼 관리자(또는 서버 내부 작업, 아래 set_user_active 함수)만 바꾼다.
-- 비활성 사용자는 current_user_role() 이 null 이라 자기 행의 이름도 바꿀 수 없다(아래 정책).
create or replace function private.guard_user_privileged_columns()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or current_setting('pedaleye.user_admin', true) = 'on' then
    return new;
  end if;
  if (new.role is distinct from old.role
      or new.org_id is distinct from old.org_id
      or new.email is distinct from old.email
      or new.is_active is distinct from old.is_active
      or new.deactivated_at is distinct from old.deactivated_at
      or new.deactivated_by is distinct from old.deactivated_by)
     and private.current_user_role() is distinct from 'super_admin'::public.user_role then
    raise exception '역할, 소속 조직, 이메일, 계정 상태는 관리자 기능으로만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 본인 행 조회는 비활성이어도 허용(비활성 안내용). 수정은 활성 사용자만.
drop policy users_update on public.users;
create policy users_update on public.users
  for update to authenticated
  using (
    (id = (select auth.uid()) and (select private.current_user_role()) is not null)
    or (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and org_id = (select private.current_user_org_id()))
  )
  with check (
    (id = (select auth.uid()) and (select private.current_user_role()) is not null)
    or (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and org_id = (select private.current_user_org_id()))
  );

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

-- 계정 활성 상태 변경(원자적: 상태 + 차량 배정 해제 + 감사 기록).
--  - 비활성화하면 로그인 차단(banned_until)과 세션 폐기까지 함께 처리
--  - 본인 계정, 마지막 활성 슈퍼 관리자는 비활성화 불가
--  - 조직 관리자는 자기 조직 운전자·조사관만
--  - p_demote: 슈퍼 관리자가 조직 관리자를 비활성화 대신 운전자로 강등(활성 유지)
create function public.set_user_active(
  p_user_id uuid,
  p_active boolean,
  p_unassign_vehicle boolean default true,
  p_demote boolean default false,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_role public.user_role := private.current_user_role();
  v_org uuid := private.current_user_org_id();
  v_target public.users%rowtype;
  v_unassigned text[] := '{}';
begin
  if v_caller is null or v_role is null or v_role not in ('super_admin', 'org_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_target from public.users where id = p_user_id for update;
  if not found or (v_role = 'org_admin' and (v_target.org_id is distinct from v_org or v_target.role not in ('driver', 'investigator'))) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_user_id = v_caller then
    raise exception 'SELF' using errcode = 'P0001';
  end if;
  if v_target.role = 'super_admin' and v_role <> 'super_admin' then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_demote and (v_role <> 'super_admin' or v_target.role <> 'org_admin' or p_active) then
    raise exception 'INVALID_DEMOTE' using errcode = 'P0001';
  end if;

  perform set_config('pedaleye.user_admin', 'on', true);
  perform set_config('pedaleye.audit_reason', left(coalesce(trim(p_reason), ''), 200), true);

  if p_demote then
    update public.users set role = 'driver' where id = p_user_id;
  elsif p_active then
    if v_target.is_active then
      perform set_config('pedaleye.user_admin', '', true);
      return jsonb_build_object('changed', false, 'unassigned', v_unassigned);
    end if;
    update public.users set is_active = true, deactivated_at = null, deactivated_by = null where id = p_user_id;
    update auth.users set banned_until = null where id = p_user_id;
  else
    if not v_target.is_active then
      perform set_config('pedaleye.user_admin', '', true);
      return jsonb_build_object('changed', false, 'unassigned', v_unassigned);
    end if;
    if v_target.role = 'super_admin'
       and (select count(*) from public.users where role = 'super_admin' and is_active) <= 1 then
      raise exception 'LAST_SUPER_ADMIN' using errcode = 'P0001';
    end if;
    update public.users set is_active = false, deactivated_at = now(), deactivated_by = v_caller where id = p_user_id;
    -- 로그인 차단 + 모든 기기의 세션·갱신 토큰 폐기(이미 받은 접근 토큰은 위 권한 함수가 RLS 에서 막음)
    update auth.users set banned_until = now() + interval '100 years' where id = p_user_id;
    delete from auth.sessions where user_id = p_user_id;
  end if;

  if p_unassign_vehicle and (not p_active or p_demote) then
    with cleared as (
      update public.vehicles set assigned_user_id = null where assigned_user_id = p_user_id returning plate_number
    )
    select coalesce(array_agg(plate_number), '{}') into v_unassigned from cleared;
  end if;

  perform set_config('pedaleye.user_admin', '', true);
  perform set_config('pedaleye.audit_reason', '', true);
  return jsonb_build_object('changed', true, 'unassigned', v_unassigned);
end;
$$;
revoke execute on function public.set_user_active(uuid, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.set_user_active(uuid, boolean, boolean, boolean, text) to authenticated;

-- 목록에 '최근 로그인'을 보여 주기 위한 조회. 호출자가 볼 수 있는 사용자(RLS 와 같은 범위)만 돌려준다.
create function public.user_last_sign_in(p_user_ids uuid[])
returns table (id uuid, last_sign_in_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.last_sign_in_at
  from auth.users a
  join public.users u on u.id = a.id
  where a.id = any (p_user_ids)
    and cardinality(p_user_ids) <= 200
    and (private.current_user_role() = 'super_admin'
         or (private.current_user_role() = 'org_admin' and u.org_id = private.current_user_org_id()));
$$;
revoke execute on function public.user_last_sign_in(uuid[]) from public, anon;
grant execute on function public.user_last_sign_in(uuid[]) to authenticated;
