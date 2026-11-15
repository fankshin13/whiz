-- 중복 업로드 방지는 검증 통과 세션에만 적용한다.
-- 정상 세션을 일부 변조해 다시 올리면 시작 시각·끝 해시가 같을 수 있는데,
-- 이 변조본은 기존 정상 세션으로 합쳐지지 않고 감사 기록으로 따로 남아야 한다.
drop index public.uq_event_sessions_device_start_final;
create unique index uq_event_sessions_verified_device_start_final
  on public.event_sessions (device_id, start_time, final_chain_hash)
  where integrity_verified;
