-- 사고조사관(investigator) 초대: 슈퍼 관리자는 모든 조직, 조직 관리자는 자기 조직에만. 조사관 초대에는 차량을 붙이지 않는다.
-- 수락(public.accept_invitation)은 초대의 role 을 그대로 주고 vehicle_id 가 없으면 배정을 건너뛰므로 바꾸지 않는다.
-- 취소·재발급 함수(private.can_manage_invitation)는 이미 조직 관리자에게 운전자·조사관 초대를 허용한다.

alter table public.invitations drop constraint chk_invitation_role;
alter table public.invitations
  add constraint chk_invitation_role check (role in ('driver', 'org_admin', 'investigator')),
  add constraint chk_invitation_vehicle_driver_only check (role = 'driver' or vehicle_id is null);

drop policy invitations_insert on public.invitations;
create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and used_at is null
    and accepted_user_id is null
    and revoked_at is null
    and (
      -- 슈퍼 관리자: 모든 조직, 운전자·조직 관리자·조사관 초대
      (select private.current_user_role()) = 'super_admin'
      -- 조직 관리자: 자기 조직의 운전자·조사관 초대만(조직 관리자 초대는 불가)
      or ((select private.current_user_role()) = 'org_admin'
          and org_id = (select private.current_user_org_id())
          and role in ('driver', 'investigator'))
    )
    and (role = 'driver' or vehicle_id is null)
    and (
      vehicle_id is null
      or exists (select 1 from public.vehicles v
                 where v.id = invitations.vehicle_id and v.org_id = invitations.org_id)
    )
  );
