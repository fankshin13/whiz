-- 조직 관리자(org_admin) 초대는 슈퍼 관리자만 만들 수 있게 한다.
-- 기존 정책은 조직 관리자가 자기 조직에 role=org_admin 초대를 넣는 것(관리자 권한 자가 확장)을 막지 않았다.
-- 초대 수락(public.accept_invitation)은 vehicle_id 가 없으면 차량 배정을 건너뛰고 초대의 role 을 그대로 부여하므로 바꾸지 않는다.

drop policy invitations_insert on public.invitations;

create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and used_at is null
    and accepted_user_id is null
    and (
      -- 슈퍼 관리자: 모든 조직, 운전자·조직 관리자 초대
      (select private.current_user_role()) = 'super_admin'
      -- 조직 관리자: 자기 조직의 운전자 초대만
      or ((select private.current_user_role()) = 'org_admin'
          and org_id = (select private.current_user_org_id())
          and role = 'driver')
    )
    -- 조직 관리자 초대에는 차량을 붙이지 않는다
    and (role = 'driver' or vehicle_id is null)
    and (
      vehicle_id is null
      or exists (select 1 from public.vehicles v
                 where v.id = invitations.vehicle_id and v.org_id = invitations.org_id)
    )
  );
