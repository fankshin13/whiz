-- 페달아이 MVP 기본 스키마: 조직·사용자·차량·단말·이벤트 세션 + RLS
-- 모든 시각은 timestamptz(절대 시각)로 저장하고, 표시 기준 시간대는 Asia/Seoul.

alter database postgres set timezone to 'Asia/Seoul';

-- 1. ENUM ----------------------------------------------------------------
create type public.organization_type as enum ('fleet', 'b2g', 'standard');
create type public.user_role as enum ('super_admin', 'org_admin', 'driver', 'investigator');
create type public.trigger_type as enum ('shock', 'sudden_accel', 'manual', 'periodic');

-- 2. 테이블 --------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.organization_type not null default 'standard',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete restrict,
  email text not null unique,
  name text not null,
  role public.user_role not null default 'driver',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  vin_masked text,
  plate_number text not null,
  model_name text not null,
  model_year integer,
  assigned_user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  serial_number text not null unique,
  mac_address text,
  vehicle_id uuid unique references public.vehicles (id) on delete set null,
  hardware_rev text not null default 'v1.0',
  firmware_version text not null default '1.0.0',
  accel_calib_min integer not null default 0,
  accel_calib_max integer not null default 4095,
  brake_calib_min integer not null default 0,
  brake_calib_max integer not null default 4095,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.event_sessions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  trigger_type public.trigger_type not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  record_count integer not null default 0,
  initial_chain_hash text not null,
  final_chain_hash text not null,
  integrity_verified boolean not null default false,
  raw_log_storage_path text,
  created_at timestamptz not null default now(),
  constraint event_sessions_time_order check (end_time >= start_time)
);

-- devices.vehicle_id, users.email 은 unique 제약이 인덱스를 겸함
create index idx_users_org_id on public.users (org_id);
create index idx_users_role on public.users (role);
create index idx_vehicles_org_id on public.vehicles (org_id);
create index idx_vehicles_assigned_user on public.vehicles (assigned_user_id);
create index idx_event_sessions_device_id on public.event_sessions (device_id);
create index idx_event_sessions_start_time on public.event_sessions (start_time desc);

-- 3. 비공개 스키마 헬퍼 (API로 노출되지 않음) ----------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.current_user_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select u.role from public.users u where u.id = (select auth.uid());
$$;

create function private.current_user_org_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select u.org_id from public.users u where u.id = (select auth.uid());
$$;

revoke execute on function private.current_user_role() from public, anon, authenticated;
revoke execute on function private.current_user_org_id() from public, anon, authenticated;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.current_user_org_id() to authenticated;

-- updated_at 자동 갱신
create function private.set_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.set_updated_at() from public, anon, authenticated;

create trigger trg_organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger trg_users_updated_at before update on public.users
  for each row execute function private.set_updated_at();
create trigger trg_vehicles_updated_at before update on public.vehicles
  for each row execute function private.set_updated_at();
create trigger trg_devices_updated_at before update on public.devices
  for each row execute function private.set_updated_at();

-- role / org_id / email 변경은 super_admin(또는 서버 내부 작업)만 허용
create function private.guard_user_privileged_columns()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (new.role is distinct from old.role
      or new.org_id is distinct from old.org_id
      or new.email is distinct from old.email)
     and (select auth.uid()) is not null
     and private.current_user_role() is distinct from 'super_admin'::public.user_role then
    raise exception '역할, 소속 조직, 이메일은 슈퍼 관리자만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_user_privileged_columns() from public, anon, authenticated;

create trigger trg_users_guard_privileged before update on public.users
  for each row execute function private.guard_user_privileged_columns();

-- auth.users 생성 시 프로필 자동 생성. 역할·조직은 사용자 메타데이터를 믿지 않고
-- 항상 driver / 조직 없음으로 시작한다(권한 상승 차단).
create function private.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;
revoke execute on function private.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- 4. 권한: 기본 grant 회수 후 필요한 것만 부여 -----------------------------
alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.vehicles enable row level security;
alter table public.devices enable row level security;
alter table public.event_sessions enable row level security;

revoke all on public.organizations, public.users, public.vehicles, public.devices, public.event_sessions
  from public, anon, authenticated;

grant select, insert, update, delete on public.organizations to authenticated;
grant select, update on public.users to authenticated;
grant select, insert, update, delete on public.vehicles to authenticated;
grant select, insert, update, delete on public.devices to authenticated;
-- 증거 기록은 수정·삭제 불가 (검증 결과 갱신은 서버 파이프라인이 service_role로 수행)
grant select, insert on public.event_sessions to authenticated;

-- 5. 정책 ----------------------------------------------------------------
-- organizations
create policy organizations_select on public.organizations
  for select to authenticated
  using (
    (select private.current_user_role()) = 'super_admin'
    or id = (select private.current_user_org_id())
  );
create policy organizations_insert on public.organizations
  for insert to authenticated
  with check ((select private.current_user_role()) = 'super_admin');
create policy organizations_update on public.organizations
  for update to authenticated
  using ((select private.current_user_role()) = 'super_admin')
  with check ((select private.current_user_role()) = 'super_admin');
create policy organizations_delete on public.organizations
  for delete to authenticated
  using ((select private.current_user_role()) = 'super_admin');

-- users
create policy users_select on public.users
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and org_id = (select private.current_user_org_id()))
  );
create policy users_update on public.users
  for update to authenticated
  using (
    id = (select auth.uid())
    or (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and org_id = (select private.current_user_org_id()))
  )
  with check (
    id = (select auth.uid())
    or (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and org_id = (select private.current_user_org_id()))
  );

-- vehicles
create policy vehicles_select on public.vehicles
  for select to authenticated
  using (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) in ('org_admin', 'investigator')
        and org_id = (select private.current_user_org_id()))
    or ((select private.current_user_role()) = 'driver'
        and assigned_user_id = (select auth.uid()))
  );
create policy vehicles_insert on public.vehicles
  for insert to authenticated
  with check (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and org_id = (select private.current_user_org_id()))
  );
create policy vehicles_update on public.vehicles
  for update to authenticated
  using (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and org_id = (select private.current_user_org_id()))
  )
  with check (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and org_id = (select private.current_user_org_id()))
  );
create policy vehicles_delete on public.vehicles
  for delete to authenticated
  using (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and org_id = (select private.current_user_org_id()))
  );

-- devices: 장착 차량을 볼 수 있으면 조회 가능. 미장착 재고 단말은 관리자만 조회(바인딩용).
create policy devices_select on public.devices
  for select to authenticated
  using (
    (select private.current_user_role()) = 'super_admin'
    or (vehicle_id is null and (select private.current_user_role()) = 'org_admin')
    or exists (select 1 from public.vehicles v where v.id = devices.vehicle_id)
  );
create policy devices_insert on public.devices
  for insert to authenticated
  with check (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and exists (select 1 from public.vehicles v
                    where v.id = devices.vehicle_id
                      and v.org_id = (select private.current_user_org_id())))
  );
create policy devices_update on public.devices
  for update to authenticated
  using (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and (vehicle_id is null
             or exists (select 1 from public.vehicles v
                        where v.id = devices.vehicle_id
                          and v.org_id = (select private.current_user_org_id()))))
  )
  with check (
    (select private.current_user_role()) = 'super_admin'
    or ((select private.current_user_role()) = 'org_admin'
        and (vehicle_id is null
             or exists (select 1 from public.vehicles v
                        where v.id = devices.vehicle_id
                          and v.org_id = (select private.current_user_org_id()))))
  );
create policy devices_delete on public.devices
  for delete to authenticated
  using ((select private.current_user_role()) = 'super_admin');

-- event_sessions: 연결 차량을 볼 수 있으면 조회. 업로드는 배정 운전자·소속 관리자·슈퍼 관리자.
create policy event_sessions_select on public.event_sessions
  for select to authenticated
  using (
    exists (select 1 from public.devices d where d.id = event_sessions.device_id)
  );
create policy event_sessions_insert on public.event_sessions
  for insert to authenticated
  with check (
    (select private.current_user_role()) = 'super_admin'
    or exists (
      select 1
      from public.devices d
      join public.vehicles v on v.id = d.vehicle_id
      where d.id = event_sessions.device_id
        and (
          ((select private.current_user_role()) = 'org_admin'
           and v.org_id = (select private.current_user_org_id()))
          or ((select private.current_user_role()) = 'driver'
              and v.assigned_user_id = (select auth.uid()))
        )
    )
  );
