-- 운영 DB 배포 점검(읽기 전용). Supabase 대시보드 SQL Editor 또는 psql 로 실행한다.
-- 모든 행의 ok 가 true 여야 배포 완료로 본다.

with expected_tables(name) as (
  values ('organizations'), ('users'), ('vehicles'), ('devices'), ('event_sessions'), ('invitations'), ('audit_logs')
),
expected_migrations(version) as (
  values ('20261115000001'), ('20261115000002'), ('20261115000003'), ('20261115000004'),
         ('20261115000005'), ('20261115000006'), ('20261115000007'),
         ('20261117000008'), ('20261117000009'), ('20261117000010'), ('20261117000011'), ('20261117000012'), ('20261117000013'), ('20261117000014'), ('20261117000015'), ('20261117000016')
)
select 'table:' || e.name as check_item,
       (t.tablename is not null) as ok,
       coalesce(case when t.rowsecurity then 'RLS on' else 'RLS OFF' end, 'missing') as detail
from expected_tables e
left join pg_tables t on t.schemaname = 'public' and t.tablename = e.name
where true
union all
select 'rls:' || e.name, coalesce(t.rowsecurity, false), coalesce(t.rowsecurity::text, 'missing')
from expected_tables e
left join pg_tables t on t.schemaname = 'public' and t.tablename = e.name
union all
select 'migration:' || m.version,
       exists (select 1 from supabase_migrations.schema_migrations s where s.version = m.version),
       ''
from expected_migrations m
union all
select 'anon_has_no_table_grants',
       not exists (
         select 1 from information_schema.role_table_grants g
         where g.grantee = 'anon' and g.table_schema = 'public'
           and g.table_name in (select name from expected_tables)
       ),
       ''
union all
select 'event_sessions_no_direct_insert',
       not has_table_privilege('authenticated', 'public.event_sessions', 'INSERT'),
       ''
union all
select 'bucket_event_logs_private',
       coalesce((select not public from storage.buckets where id = 'event-logs'), false),
       coalesce((select 'public=' || public::text from storage.buckets where id = 'event-logs'), 'missing')
union all
select 'accept_invitation_service_role_only',
       has_function_privilege('service_role', 'public.accept_invitation(text, uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.accept_invitation(text, uuid)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.accept_invitation(text, uuid)', 'EXECUTE'),
       ''
union all
select 'org_admin_invitations_super_admin_only',
       exists (select 1 from pg_policy
               where polname = 'invitations_insert'
                 and pg_get_expr(polwithcheck, polrelid) like '%role = ''driver''%'),
       ''
union all
select 'vehicle_plate_unique_index',
       exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_vehicles_plate_normalized'),
       ''
union all
select 'device_org_inventory',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'devices' and column_name = 'org_id')
       and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'mount_device'),
       ''
union all
select 'mount_device_not_anon',
       not coalesce(has_function_privilege('anon', 'public.mount_device(uuid, uuid, boolean)', 'execute'), false),
       ''
union all
select 'devices_without_org',
       not exists (select 1 from public.devices where org_id is null),
       (select count(*)::text || '대: 슈퍼 관리자가 차량에 장착하면 그 조직으로 정해짐' from public.devices where org_id is null)
union all
select 'audit_logs_read_only_for_clients',
       has_table_privilege('authenticated', 'public.audit_logs', 'SELECT')
       and not has_table_privilege('authenticated', 'public.audit_logs', 'INSERT')
       and not has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE')
       and not has_table_privilege('authenticated', 'public.audit_logs', 'DELETE')
       and not has_table_privilege('anon', 'public.audit_logs', 'SELECT'),
       ''
union all
select 'audit_logs_immutable_triggers',
       (select count(*) from pg_trigger where tgrelid = 'public.audit_logs'::regclass
          and tgname in ('trg_audit_logs_immutable', 'trg_audit_logs_no_truncate') and tgenabled <> 'D') = 2,
       ''
union all
select 'audit_change_triggers',
       (select count(*) from pg_trigger where tgname in ('trg_audit_organizations', 'trg_audit_vehicles', 'trg_audit_devices',
          'trg_audit_invitations', 'trg_audit_users') and tgenabled <> 'D') = 5,
       ''
union all
select 'log_admin_audit_event_not_anon',
       not has_function_privilege('anon', 'public.log_admin_audit_event(public.audit_action_type, text, text, text, jsonb, public.audit_status)', 'EXECUTE'),
       ''
union all
select 'user_deactivation',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'is_active')
       and position('is_active' in pg_get_functiondef('private.current_user_role()'::regprocedure)) > 0
       and not has_function_privilege('anon', 'public.set_user_active(uuid, boolean, boolean, boolean, text)', 'EXECUTE'),
       ''
union all
select 'user_deactivation_can_ban',
       -- set_user_active(소유자 postgres)가 로그인 차단·세션 폐기를 할 수 있어야 한다
       has_table_privilege('postgres', 'auth.users', 'UPDATE') and has_table_privilege('postgres', 'auth.sessions', 'DELETE'),
       ''
union all
select 'invitation_revoke_reissue',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invitations' and column_name = 'revoked_at')
       and position('REVOKED' in pg_get_functiondef('public.accept_invitation(text, uuid)'::regprocedure)) > 0
       and not has_function_privilege('anon', 'public.revoke_invitation(uuid, text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.reissue_invitation(uuid, text, integer)', 'EXECUTE')
       and not has_table_privilege('authenticated', 'public.invitations', 'UPDATE'),
       ''
union all
select 'investigator_invitations',
       exists (select 1 from pg_constraint where conname = 'chk_invitation_vehicle_driver_only')
       and position('investigator' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'chk_invitation_role')) > 0
       and exists (select 1 from pg_policy where polname = 'invitations_insert'
                   and pg_get_expr(polwithcheck, polrelid) like '%investigator%'),
       ''
union all
select 'device_auth_public_key',
       exists (select 1 from pg_constraint where conname = 'chk_devices_auth_public_key_format')
       and position('auth_public_key' in pg_get_functiondef('private.guard_device_driver_update()'::regprocedure)) > 0
       and not has_function_privilege('anon', 'public.set_device_public_key(uuid, text, text)', 'EXECUTE'),
       ''
union all
select 'devices_without_auth_key',
       not exists (select 1 from public.devices where auth_public_key is null),
       (select count(*)::text || '대: 인증 미설정(시험 단말). 출하 공개키를 등록하세요' from public.devices where auth_public_key is null)
union all
select 'device_sealed_sessions',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'event_sessions' and column_name = 'device_seal_verified')
       and exists (select 1 from pg_constraint where conname = 'chk_event_sessions_seal_pair'),
       ''
union all
select 'database_timezone_asia_seoul',
       current_setting('timezone') = 'Asia/Seoul',
       current_setting('timezone')
union all
select 'no_seed_test_accounts',
       not exists (select 1 from auth.users where email like '%@pedaleye.test'),
       '';
