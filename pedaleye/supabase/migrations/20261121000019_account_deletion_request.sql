-- 본인 계정 삭제 요청(Play 정책·개인정보 보호법 정보주체 권리).
-- 결정(2026-11-21, CPO): 요청 즉시 비활성화(로그인 차단·세션 폐기·차량 배정 해제)하고,
-- 계정 정보는 비활성화 후 1년, 사고 기록은 생성 후 3년 보관한 뒤 파기한다(파기는 별도 자동 작업).

alter table public.users add column deletion_requested_at timestamptz;

-- 삭제 요청 시각도 관리자 기능(또는 아래 함수)으로만 바뀐다
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
      or new.deactivated_by is distinct from old.deactivated_by
      or new.deletion_requested_at is distinct from old.deletion_requested_at)
     and private.current_user_role() is distinct from 'super_admin'::public.user_role then
    raise exception '역할, 소속 조직, 이메일, 계정 상태는 관리자 기능으로만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 본인 요청: 감사 로그에는 '계정 비활성화'(수행자 = 본인, 사유 = 본인 계정 삭제 요청)로 남는다.
-- 슈퍼 관리자는 다른 슈퍼 관리자가 처리한다(마지막 관리자가 스스로 잠그는 일을 막음).
create function public.request_account_deletion(p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_user public.users%rowtype;
  v_unassigned text[] := '{}';
begin
  if v_uid is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_user from public.users where id = v_uid for update;
  if not found or not v_user.is_active then
    raise exception 'ALREADY_INACTIVE' using errcode = 'P0001';
  end if;
  if v_user.role = 'super_admin' then
    raise exception 'SUPER_ADMIN_SELF' using errcode = 'P0001';
  end if;

  perform set_config('pedaleye.user_admin', 'on', true);
  perform set_config('pedaleye.audit_reason',
    left('본인 계정 삭제 요청' || coalesce(': ' || nullif(trim(p_reason), ''), ''), 200), true);

  update public.users
     set is_active = false, deactivated_at = now(), deactivated_by = v_uid, deletion_requested_at = now()
   where id = v_uid;

  with cleared as (
    update public.vehicles set assigned_user_id = null where assigned_user_id = v_uid returning plate_number
  )
  select coalesce(array_agg(plate_number), '{}') into v_unassigned from cleared;

  -- 로그인 차단 + 모든 기기의 세션·갱신 토큰 폐기
  update auth.users set banned_until = now() + interval '100 years' where id = v_uid;
  delete from auth.sessions where user_id = v_uid;

  perform set_config('pedaleye.user_admin', '', true);
  perform set_config('pedaleye.audit_reason', '', true);
  return jsonb_build_object('unassigned', v_unassigned);
end;
$$;
revoke execute on function public.request_account_deletion(text) from public, anon;
grant execute on function public.request_account_deletion(text) to authenticated;
