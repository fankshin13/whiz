-- 운영 DB 배포 점검(읽기 전용). Supabase 대시보드 SQL Editor 또는 psql 로 실행한다.
-- 모든 행의 ok 가 true 여야 배포 완료로 본다.

with expected_tables(name) as (
  values ('organizations'), ('users'), ('vehicles'), ('devices'), ('event_sessions'), ('invitations')
),
expected_migrations(version) as (
  values ('20261115000001'), ('20261115000002'), ('20261115000003'), ('20261115000004'),
         ('20261115000005'), ('20261115000006'), ('20261115000007')
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
select 'database_timezone_asia_seoul',
       current_setting('timezone') = 'Asia/Seoul',
       current_setting('timezone')
union all
select 'no_seed_test_accounts',
       not exists (select 1 from auth.users where email like '%@pedaleye.test'),
       '';
