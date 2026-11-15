-- 1회용 만료 초대 링크. DB 에는 토큰 원문이 아닌 SHA-256 해시만 저장한다.

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  email text not null,
  invitee_name text not null,
  role public.user_role not null default 'driver',
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  accepted_user_id uuid references public.users (id) on delete set null,
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_invitation_role check (role in ('driver', 'org_admin')),
  constraint chk_invitation_expiry check (expires_at > created_at),
  constraint chk_invitation_email check (email = lower(email))
);

create index idx_invitations_org_id on public.invitations (org_id);
create index idx_invitations_vehicle_id on public.invitations (vehicle_id);
create index idx_invitations_email on public.invitations (email);
create index idx_invitations_created_by on public.invitations (created_by);
create index idx_invitations_accepted_user_id on public.invitations (accepted_user_id);

create trigger trg_invitations_updated_at before update on public.invitations
  for each row execute function private.set_updated_at();

alter table public.invitations enable row level security;
revoke all on public.invitations from public, anon, authenticated;
-- 관리자는 조회·생성만. 토큰 소모(used_at)는 아래 서버 전용 함수만 수행한다.
grant select, insert on public.invitations to authenticated;

create policy invitations_select on public.invitations
  for select to authenticated
  using (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and org_id = (select private.current_user_org_id()))
  );

create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and used_at is null
    and accepted_user_id is null
    and (
      (select private.current_user_role()) = 'super_admin'
      or ((select private.current_user_role()) = 'org_admin'
          and org_id = (select private.current_user_org_id()))
    )
    and (
      vehicle_id is null
      or exists (select 1 from public.vehicles v
                 where v.id = invitations.vehicle_id and v.org_id = invitations.org_id)
    )
  );

-- 초대 수락: 행 잠금 → 유효성 검사 → 프로필 조직·역할 지정 → 차량 배정 → 토큰 소모를 한 트랜잭션으로.
-- 서버(service_role)만 호출한다. 실패 시 예외로 전체 롤백.
create function public.accept_invitation(p_token_hash text, p_user_id uuid)
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

revoke execute on function public.accept_invitation(text, uuid) from public, anon, authenticated;
grant execute on function public.accept_invitation(text, uuid) to service_role;
