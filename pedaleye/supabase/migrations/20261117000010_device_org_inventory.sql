-- 단말 재고를 조직별로 나눈다(결정: 2026-11-17).
-- 슈퍼 관리자가 등록 시 조직을 지정하고, 조직 관리자는 자기 조직 재고만 보고 자기 조직 차량에만 장착한다.
-- 장착 해제·교체된 단말은 그 조직 재고(vehicle_id = null, org_id 유지)로 돌아간다.

alter table public.devices add column org_id uuid references public.organizations (id);

-- 기존 장착 단말은 차량의 조직을 따른다. 조직이 없는 기존 미장착 단말은 슈퍼 관리자만 보며, 장착할 때 조직이 정해진다.
update public.devices d set org_id = v.org_id from public.vehicles v where v.id = d.vehicle_id;

create index idx_devices_org_id on public.devices (org_id);

-- 조회: 슈퍼 관리자 전체, 조직 관리자 자기 조직 단말(장착+재고), 그 외는 볼 수 있는 차량에 장착된 단말만.
drop policy devices_select on public.devices;
create policy devices_select on public.devices
  for select to authenticated
  using (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin' and org_id = (select private.current_user_org_id()))
    or (vehicle_id is not null and exists (select 1 from public.vehicles v where v.id = devices.vehicle_id))
  );

-- 등록(재고 입고)은 슈퍼 관리자만.
drop policy devices_insert on public.devices;
create policy devices_insert on public.devices
  for insert to authenticated
  with check ((select private.current_user_role()) = 'super_admin');

-- 수정: 조직 관리자는 자기 조직 단말만, 장착 대상도 자기 조직 차량만. 운전자는 본인 배정 차량 단말(보정값만, 트리거로 제한).
drop policy devices_update on public.devices;
create policy devices_update on public.devices
  for update to authenticated
  using (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin' and org_id = (select private.current_user_org_id()))
    or ((select private.current_user_role()) = 'driver'
        and exists (select 1 from public.vehicles v
                    where v.id = devices.vehicle_id and v.assigned_user_id = (select auth.uid())))
  )
  with check (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and org_id = (select private.current_user_org_id())
        and (vehicle_id is null
             or exists (select 1 from public.vehicles v
                        where v.id = devices.vehicle_id
                          and v.org_id = (select private.current_user_org_id()))))
    or ((select private.current_user_role()) = 'driver'
        and exists (select 1 from public.vehicles v
                    where v.id = devices.vehicle_id and v.assigned_user_id = (select auth.uid())))
  );

-- 단말의 소속 조직·일련번호는 슈퍼 관리자(또는 서버 내부 작업)만 바꾼다. 운전자 제한(보정값만)은 그대로 유지.
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
          or new.hardware_rev is distinct from old.hardware_rev
          or new.firmware_version is distinct from old.firmware_version
          or new.last_synced_at is distinct from old.last_synced_at
          or new.created_at is distinct from old.created_at) then
    raise exception '운전자는 페달 보정값만 수정할 수 있습니다.' using errcode = '42501';
  end if;
  if new.org_id is distinct from old.org_id or new.serial_number is distinct from old.serial_number then
    raise exception '단말의 소속 조직과 일련번호는 슈퍼 관리자만 변경할 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_device_driver_update() from public, anon, authenticated;

-- 장착·교체를 한 트랜잭션으로 처리한다(vehicle_id 가 unique 라 '기존 해제 → 새 장착' 순서가 필요).
-- 새로 장착한 단말은 이전 차량의 보정값을 쓰면 안 되므로 공장 기본값으로 되돌린다(장착 후 보정 필요).
-- 호출자 권한을 함수 안에서 직접 확인한다(security definer 라 RLS 를 거치지 않음).
create function public.mount_device(p_device_id uuid, p_vehicle_id uuid, p_replace boolean default false)
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
    update public.devices set vehicle_id = null where id = v_current.id;
  end if;

  update public.devices
     set vehicle_id = p_vehicle_id,
         org_id = v_vehicle.org_id,
         accel_calib_min = 0, accel_calib_max = 4095,
         brake_calib_min = 0, brake_calib_max = 4095
   where id = v_device.id;

  return jsonb_build_object(
    'device_id', v_device.id,
    'replaced_device_id', v_current.id,
    'replaced_serial', v_current.serial_number
  );
end;
$$;
revoke execute on function public.mount_device(uuid, uuid, boolean) from public, anon;
grant execute on function public.mount_device(uuid, uuid, boolean) to authenticated;
