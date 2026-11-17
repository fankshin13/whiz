-- 로컬 개발·테스트 전용 시드 데이터. 운영 DB에 실행하지 마세요.
-- 모든 테스트 계정 비밀번호: Pedaleye-Test-2026!  (로컬 전용 값)

insert into public.organizations (id, name, type) values
  ('10000000-0000-0000-0000-000000000001', '화성시 교통안전과', 'b2g'),
  ('10000000-0000-0000-0000-000000000002', '서울법인택시', 'fleet');

with seed_users (id, email, name) as (
  values
    ('20000000-0000-0000-0000-000000000001'::uuid, 'super@pedaleye.test', '운영 슈퍼관리자'),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'admin.hwaseong@pedaleye.test', '화성시 관리자'),
    ('20000000-0000-0000-0000-000000000003'::uuid, 'driver.a@pedaleye.test', '화성 운전자 A'),
    ('20000000-0000-0000-0000-000000000004'::uuid, 'driver.b@pedaleye.test', '화성 운전자 B'),
    ('20000000-0000-0000-0000-000000000005'::uuid, 'investigator.hwaseong@pedaleye.test', '화성 사고조사관'),
    ('20000000-0000-0000-0000-000000000006'::uuid, 'admin.seoul@pedaleye.test', '서울택시 관리자'),
    ('20000000-0000-0000-0000-000000000007'::uuid, 'driver.c@pedaleye.test', '서울택시 운전자 C')
), inserted as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    extensions.crypt('Pedaleye-Test-2026!', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('name', name), now(), now(),
    '', '', '', ''
  from seed_users
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text,
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       'email', now(), now(), now()
from inserted;

-- on_auth_user_created 트리거가 driver/조직 없음으로 만든 프로필에 역할·조직 지정
update public.users u set role = s.role::public.user_role, org_id = s.org_id::uuid
from (values
  ('20000000-0000-0000-0000-000000000001', 'super_admin', null),
  ('20000000-0000-0000-0000-000000000002', 'org_admin', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000003', 'driver', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000004', 'driver', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000005', 'investigator', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000006', 'org_admin', '10000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000007', 'driver', '10000000-0000-0000-0000-000000000002')
) as s (id, role, org_id)
where u.id = s.id::uuid;

insert into public.vehicles (id, org_id, vin_masked, plate_number, model_name, model_year, assigned_user_id) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'KMH*********1234', '12가 3456', '아반떼', 2021, '20000000-0000-0000-0000-000000000003'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'KNA*********5678', '34나 7890', '쏘렌토', 2019, '20000000-0000-0000-0000-000000000004'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'KMH*********9012', '서울32바 1234', '쏘나타 택시', 2023, '20000000-0000-0000-0000-000000000007'),
  -- 운전자 미배정 차량(초대 링크 흐름 확인용)
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'KMF*********3456', '56다 1004', '포터2', 2022, null);

-- 단말 재고는 조직별(org_id). PE-2026-000004 는 화성시 미장착 재고
insert into public.devices (id, serial_number, mac_address, vehicle_id, org_id) values
  ('40000000-0000-0000-0000-000000000001', 'PE-2026-000001', 'AA:BB:CC:00:00:01', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', 'PE-2026-000002', 'AA:BB:CC:00:00:02', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000003', 'PE-2026-000003', 'AA:BB:CC:00:00:03', '30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000004', 'PE-2026-000004', 'AA:BB:CC:00:00:04', null, '10000000-0000-0000-0000-000000000001');

insert into public.event_sessions (id, device_id, trigger_type, start_time, end_time, record_count, initial_chain_hash, final_chain_hash) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'shock',
   '2026-11-10 08:15:00+09', '2026-11-10 08:16:00+09', 3000,
   repeat('0', 64), repeat('a', 64)),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 'manual',
   '2026-11-12 22:40:00+09', '2026-11-12 22:41:00+09', 3000,
   repeat('0', 64), repeat('b', 64));
