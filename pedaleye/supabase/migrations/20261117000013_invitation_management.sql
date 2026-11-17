-- 초대 관리: 대기 초대 취소·재발급. 취소된 초대는 웹·앱 어디서도 수락할 수 없다.
-- 초대 행은 관리자가 직접 수정할 수 없고(UPDATE 권한 없음), 아래 함수로만 취소·재발급한다.

alter table public.invitations
  add column revoked_at timestamptz,
  add column revoked_by uuid; -- 외래 키 없음: 취소한 관리자 계정이 지워져도 이력은 남긴다

create index idx_invitations_org_created on public.invitations (org_id, created_at desc);

-- 수락: 취소된 초대 거부 추가
create or replace function public.accept_invitation(p_token_hash text, p_user_id uuid)
returns public.user_role
language plpgsql security definer set search_path = ''
as $$
declare
  inv public.invitations%rowtype;
  profile_email text;
begin
  select * into inv from public.invitations where token_hash = p_token_hash for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if inv.revoked_at is not null then
    raise exception 'REVOKED' using errcode = 'P0001';
  end if;
  if inv.used_at is not null then
    raise exception 'ALREADY_USED' using errcode = 'P0001';
  end if;
  if inv.expires_at <= now() then
    raise exception 'EXPIRED' using errcode = 'P0001';
  end if;

  select u.email into profile_email from public.users u where u.id = p_user_id;
  if profile_email is null or lower(profile_email) <> inv.email then
    raise exception 'EMAIL_MISMATCH' using errcode = 'P0001';
  end if;

  update public.users
     set org_id = inv.org_id, role = inv.role, name = inv.invitee_name
   where id = p_user_id;

  if inv.vehicle_id is not null then
    update public.vehicles
       set assigned_user_id = p_user_id
     where id = inv.vehicle_id and assigned_user_id is null;
    if not found then
      raise exception 'VEHICLE_UNAVAILABLE' using errcode = 'P0001';
    end if;
  end if;

  update public.invitations
     set used_at = now(), accepted_user_id = p_user_id
   where id = inv.id;

  return inv.role;
end;
$$;


-- 관리자가 다룰 수 있는 초대인지: 슈퍼 관리자 전체, 조직 관리자는 자기 조직의 운전자·조사관 초대만
create function private.can_manage_invitation(p_org_id uuid, p_role public.user_role)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.current_user_role() = 'super_admin'
      or (private.current_user_role() = 'org_admin'
          and p_org_id = private.current_user_org_id()
          and p_role in ('driver', 'investigator'));
$$;
revoke execute on function private.can_manage_invitation(uuid, public.user_role) from public, anon, authenticated;

-- 초대 취소(멱등: 이미 취소된 초대는 그대로 성공). 수락된 초대는 취소할 수 없다.
create function public.revoke_invitation(p_invitation_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  inv public.invitations%rowtype;
begin
  if (select auth.uid()) is null or private.current_user_role() not in ('super_admin', 'org_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into inv from public.invitations where id = p_invitation_id for update;
  if not found or not private.can_manage_invitation(inv.org_id, inv.role) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if inv.used_at is not null then
    raise exception 'ALREADY_USED' using errcode = 'P0001';
  end if;
  if inv.revoked_at is not null then
    return jsonb_build_object('changed', false);
  end if;

  perform set_config('pedaleye.audit_reason', left(coalesce(trim(p_reason), ''), 200), true);
  update public.invitations set revoked_at = now(), revoked_by = (select auth.uid()) where id = inv.id;
  perform set_config('pedaleye.audit_reason', '', true);
  return jsonb_build_object('changed', true);
end;
$$;
revoke execute on function public.revoke_invitation(uuid, text) from public, anon;
grant execute on function public.revoke_invitation(uuid, text) to authenticated;

-- 재발급: 기존 초대 취소 + 같은 대상으로 새 초대 생성을 한 트랜잭션으로. 원문 토큰은 서버가 만들고 해시만 받는다.
create function public.reissue_invitation(p_invitation_id uuid, p_token_hash text, p_expires_in_hours integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  inv public.invitations%rowtype;
  v_new_id uuid;
  v_expires timestamptz;
begin
  if (select auth.uid()) is null or private.current_user_role() not in ('super_admin', 'org_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_in_hours not in (12, 24, 48, 72) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  select * into inv from public.invitations where id = p_invitation_id for update;
  if not found or not private.can_manage_invitation(inv.org_id, inv.role) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if inv.used_at is not null then
    raise exception 'ALREADY_USED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.users u where u.email = inv.email) then
    raise exception 'EMAIL_EXISTS' using errcode = 'P0001';
  end if;
  if inv.vehicle_id is not null
     and (select v.assigned_user_id from public.vehicles v where v.id = inv.vehicle_id) is not null then
    raise exception 'VEHICLE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  -- 같은 이메일·차량에 다른 활성 초대가 있으면 재발급하지 않는다(한 대상에 활성 초대 1건)
  if exists (select 1 from public.invitations o
             where o.id <> inv.id and o.used_at is null and o.revoked_at is null and o.expires_at > now()
               and (o.email = inv.email or (inv.vehicle_id is not null and o.vehicle_id = inv.vehicle_id))) then
    raise exception 'ACTIVE_EXISTS' using errcode = 'P0001';
  end if;

  perform set_config('pedaleye.audit_reason', '재발급', true);
  if inv.revoked_at is null then
    update public.invitations set revoked_at = now(), revoked_by = (select auth.uid()) where id = inv.id;
  end if;

  v_expires := now() + make_interval(hours => p_expires_in_hours);
  insert into public.invitations (org_id, vehicle_id, email, invitee_name, role, token_hash, expires_at, created_by)
  values (inv.org_id, inv.vehicle_id, inv.email, inv.invitee_name, inv.role, p_token_hash, v_expires, (select auth.uid()))
  returning id into v_new_id;
  perform set_config('pedaleye.audit_reason', '', true);

  return jsonb_build_object('invitation_id', v_new_id, 'expires_at', v_expires);
end;
$$;
revoke execute on function public.reissue_invitation(uuid, text, integer) from public, anon;
grant execute on function public.reissue_invitation(uuid, text, integer) to authenticated;
