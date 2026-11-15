-- 사고 이벤트 로그(.pel) 저장소와 등록 경로 보강.

-- 1) 증거 위조 차단: 로그인 사용자가 직접 event_sessions 를 만들면 integrity_verified 를 마음대로 넣을 수 있다.
--    등록은 서버가 권한 확인·해시 체인 검증을 마친 뒤 service_role 로만 한다.
revoke insert on public.event_sessions from authenticated;
drop policy event_sessions_insert on public.event_sessions;

-- 2) 같은 세션 중복 업로드 방지(멱등성)
create unique index uq_event_sessions_device_start_final
  on public.event_sessions (device_id, start_time, final_chain_hash);

-- 3) 비공개 버킷. 쓰기는 서버(service_role)만, 읽기는 해당 세션을 볼 수 있는 사용자만.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-logs', 'event-logs', false, 1048576, array['application/octet-stream'])
on conflict (id) do nothing;

create policy event_logs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'event-logs'
    and exists (select 1 from public.event_sessions es where es.raw_log_storage_path = storage.objects.name)
  );

create index idx_event_sessions_raw_log_path on public.event_sessions (raw_log_storage_path);
