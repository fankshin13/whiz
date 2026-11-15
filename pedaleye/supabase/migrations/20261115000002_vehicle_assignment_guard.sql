-- 차량 배정 운전자는 차량과 같은 조직 소속이어야 한다(타 조직 사용자 배정 차단).
create function private.guard_vehicle_assignment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.assigned_user_id is not null and not exists (
    select 1 from public.users u
    where u.id = new.assigned_user_id and u.org_id = new.org_id
  ) then
    raise exception '배정 운전자는 차량과 같은 조직 소속이어야 합니다.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_vehicle_assignment() from public, anon, authenticated;

create trigger trg_vehicles_guard_assignment
  before insert or update of assigned_user_id, org_id on public.vehicles
  for each row execute function private.guard_vehicle_assignment();
