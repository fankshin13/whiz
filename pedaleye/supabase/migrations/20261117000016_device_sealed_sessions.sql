-- 단말이 직접 만든 사고 기록(BLE 전송)을 서버가 검증할 수 있게 한다(docs/ble-protocol.md 5.1·5.6).
-- - 단말은 서버의 단말 ID 를 모르므로 해시 체인 시작값을 일련번호로 계산한다
-- - 단말은 세션을 닫을 때 개인키로 '봉인 서명'을 남긴다 → 서버가 등록된 공개키로 확인
-- 앱이 만든 기록(모의 센서·긴급 백업)은 기존대로 단말 ID 기준 체인이며 봉인이 없다(화면에 '단말 봉인 없음'으로 구분).

alter table public.event_sessions
  add column device_session_index bigint check (device_session_index between 0 and 4294967295),
  add column device_seal_signature text check (device_seal_signature is null or device_seal_signature ~ '^[A-Za-z0-9+/]{86}==$'),
  add column device_seal_verified boolean not null default false,
  add constraint chk_event_sessions_seal_pair check ((device_session_index is null) = (device_seal_signature is null));

comment on column public.event_sessions.device_seal_verified is '업로드 때 단말 공개키로 봉인 서명을 확인했는지. true 면 해시 체인 시작값은 일련번호 기준';
