-- 운전자가 본인 배정 차량 단말의 페달 보정값만 수정할 수 있게 한다.

create policy devices_update_assigned_driver on public.devices
  for update to authenticated
  using (
    (select private.current_user_role()) = 'driver'
    and exists (select 1 from public.vehicles v
                where v.id = devices.vehicle_id and v.assigned_user_id = (select auth.uid()))
  )
  with check (
    (select private.current_user_role()) = 'driver'
    and exists (select 1 from public.vehicles v
                where v.id = devices.vehicle_id and v.assigned_user_id = (select auth.uid()))
  );

-- 운전자는 보정값 4개(와 자동 갱신되는 updated_at) 외의 컬럼을 바꿀 수 없다.
create function private.guard_device_driver_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and private.current_user_role() = 'driver'::public.user_role
     and (new.serial_number is distinct from old.serial_number
          or new.mac_address is distinct from old.mac_address
          or new.vehicle_id is distinct from old.vehicle_id
          or new.hardware_rev is distinct from old.hardware_rev
          or new.firmware_version is distinct from old.firmware_version
          or new.last_synced_at is distinct from old.last_synced_at
          or new.created_at is distinct from old.created_at) then
    raise exception '운전자는 페달 보정값만 수정할 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_device_driver_update() from public, anon, authenticated;

create trigger trg_devices_guard_driver_update before update on public.devices
  for each row execute function private.guard_device_driver_update();

-- 보정 범위 무결성: 0% 지점 거리(max)가 100% 지점 거리(min)보다 5.00mm 이상 커야 한다.
-- 공장 기본값(0~4095)도 이 조건을 만족한다.
alter table public.devices
  add constraint chk_devices_accel_stroke check (accel_calib_max - accel_calib_min >= 500),
  add constraint chk_devices_brake_stroke check (brake_calib_max - brake_calib_min >= 500);
