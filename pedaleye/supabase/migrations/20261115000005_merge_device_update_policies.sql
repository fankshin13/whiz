-- devices UPDATE 정책을 하나로 합친다(여러 permissive 정책은 매 쿼리마다 모두 평가되어 느림).
-- 접근 범위는 그대로: super_admin 전체, org_admin 소속 조직(+미장착 재고), driver 본인 배정 차량.

drop policy devices_update on public.devices;
drop policy devices_update_assigned_driver on public.devices;

create policy devices_update on public.devices
  for update to authenticated
  using (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and (vehicle_id is null
             or exists (select 1 from public.vehicles v
                        where v.id = devices.vehicle_id
                          and v.org_id = (select private.current_user_org_id()))))
    or ((select private.current_user_role()) = 'driver'
        and exists (select 1 from public.vehicles v
                    where v.id = devices.vehicle_id and v.assigned_user_id = (select auth.uid())))
  )
  with check (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and (vehicle_id is null
             or exists (select 1 from public.vehicles v
                        where v.id = devices.vehicle_id
                          and v.org_id = (select private.current_user_org_id()))))
    or ((select private.current_user_role()) = 'driver'
        and exists (select 1 from public.vehicles v
                    where v.id = devices.vehicle_id and v.assigned_user_id = (select auth.uid())))
  );
