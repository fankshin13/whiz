# 페달아이 운전자 앱 (Flutter, Android 우선)

운전자 전용 모바일 앱입니다. 웹 콘솔(`../pedaleye`)과 같은 Supabase 계정·권한(RLS)을 씁니다.

| 항목 | 값 |
| --- | --- |
| Flutter / Dart | 3.50.0 stable / 3.14.0 (`pubspec.yaml` 의 `environment` 로 고정) |
| Android | minSdk 24(Android 7.0), 디버그 APK |
| 주요 패키지 | supabase_flutter(인증·조회), flutter_secure_storage(세션 암호화 저장), go_router(화면 이동·딥링크), http(초대 API), material_ui |

## 이번 범위
- 이메일·비밀번호 로그인, 로그아웃, 앱을 다시 열어도 로그인 유지(세션은 Android Keystore 로 암호화 저장)
- 로그인 직후 `public.users.role` 을 조회해 **운전자만** 앱 사용. 관리자·조사관은 웹 콘솔 안내 화면으로 격리
- 1회용 초대 수락: 초대 링크를 붙여 넣거나 `pedaleye://invite?token=…` 딥링크로 열기 → 비밀번호 설정 → 자동 로그인
- 홈: 운전자 이름·소속 조직, 배정 차량 카드(로딩·빈 상태·오류 상태 포함)
- 하단 탭: 홈 · 페달 보정 · 사고 기록
- 페달 보정(`/calibrate`): 가속 0% → 가속 100% → 제동 0% → 제동 100% 를 3초씩 측정 → 행정 요약·반응 확인 → `devices` 보정값 4개 저장(본인 단말만, RLS)
- 실시간 게이지(`/gauge`): 20Hz, 가속 청색·제동 적색 5단계(실물 LED 와 같은 규칙), 양발 동시 조작 주황 경고 + 진동·경고음, 3초 신호 끊김 안내와 재연결

- 사고 기록(`/records`): 긴급 백업·급제동 시뮬레이션 → 60초 해시 체인 세션(.pel)을 기기에 먼저 보관 → 연결되면 자동 업로드(`/api/events/upload`, 서버가 무결성 판정) → 본인 차량 기록 목록·상세(검증 배지, 해시 지문, 페달 시계열 그래프, 웹 PDF 보고서 열기)
  - 기기 보관 위치: 앱 전용 저장소 `events/{사용자 ID}/{localId}.pel` + `.json`(업로드 상태). 다른 계정으로 로그인하면 보이지 않습니다.
  - 네트워크가 끊겨 실패한 건은 대기로 남아 연결되면 다시 올리고, 서버가 거절한 건(권한 없음 등)은 이유를 보여 주고 자동 재시도하지 않습니다.

## 계산 엔진(웹과 같은 규칙)
`lib/core/telemetry/`, `lib/core/calibration/` 은 웹 `lib/telemetry/displacement-engine.ts`, `lib/calibration/wizard.ts`,
`lib/telemetry/pedal-calculator.ts` 를, `lib/core/forensics/` 는 `packet-codec.ts`, `hash-chain-engine.ts`, `event-buffer-freezer.ts`,
`adaptive-sampler.ts`, `mock-hardware-stream.ts` 를 그대로 옮긴 것입니다(같은 입력이면 해시 값까지 같음). `test/core/` 의 테스트는 웹 테스트와 입력·기대값이 같습니다.
규칙을 바꿀 때는 웹과 앱을 함께 고치고 양쪽 테스트를 모두 돌려 주세요.

## 센서 입력
화면은 `PedalSensorSource` 인터페이스만 씁니다. 지금은 `MockPedalSensorSource`(모의 센서: 직접 조작·정상 주행·급가속·급제동·양발 조작·신호 끊김)를
`main.dart` 에서 넣고, 단말 통신 규격이 정해지면 BLE 구현을 같은 자리에 넣습니다. 모의 센서 조작판은 모의 센서일 때만 보입니다.

## 실행

```bash
cp .env.example .env   # 공개 접속 정보만 입력
flutter pub get
flutter run --dart-define-from-file=.env
```

- 에뮬레이터에서 로컬 Supabase 를 쓸 때: `SUPABASE_URL=http://10.0.2.2:54321`, `WEB_API_BASE_URL=http://10.0.2.2:3000`
  (평문 HTTP 는 디버그 빌드에서만 허용)
- `SUPABASE_ANON_KEY` 에는 공개 키(`sb_publishable_…` 또는 anon JWT)만 들어갑니다. 다른 키를 넣으면 앱이 시작 화면에서 거부합니다.

## 검사

```bash
scripts/check.sh
```

정적 분석 → 테스트 → `flutter build apk --debug` → 소스·APK 에 서버 비밀 키 흔적이 없는지 검사합니다.
Android SDK 가 없는 환경에서는 `SKIP_APK=1 scripts/check.sh`.

로컬 Supabase·웹 서버를 띄운 상태에서 실제 연동 검사:

```bash
scripts/test-local-stack.sh
```

## 초대 API (웹 콘솔이 제공)
앱에는 서버 비밀 키가 없으므로 초대 확인·계정 생성은 웹 서버가 합니다. 둘 다 IP 당 분당 요청 수를 제한합니다.

| 요청 | 응답 |
| --- | --- |
| `POST /api/invitations/verify` `{token}` | `{isValid:true, email, inviteeName, orgName, vehiclePlate}` 또는 `{isValid:false, reason}` |
| `POST /api/invitations/accept` `{token, password}` | `{success:true, email, role}` 또는 400 `{success:false, error}` |

## 구조
```
lib/
  core/      config(접속 정보 검증) · theme(디자인 토큰) · network(Supabase·세션 저장) · router(역할 가드·딥링크) · widgets
  features/
    auth/    로그인 · 초대 수락 · 운전자 아님 안내 · 세션 상태(SessionController)
    home/    운전자 홈(배정 차량)
    shell/   하단 탭
    calibration/  페달 보정 화면·단말 조회/저장
    gauge/   실시간 게이지·모의 센서 조작판
    events/  사고 기록 백업·업로드·목록·상세(그래프)
test/        단위·위젯 테스트(기본 폭 + 320dp)
test_local/  로컬 스택 연동 검사, 디자인 확인용 캡처
```

## 알려진 한계
- 관리자가 보내는 링크는 웹 주소(`…/auth/invite?token=…`)입니다. 휴대폰에서 이 주소를 누르면 브라우저가 열리므로, 앱에서는 링크를 복사해 '초대 수락' 화면에 붙여 넣습니다. 웹 주소로 바로 앱을 여는 App Links 는 배포 도메인 확정 후 추가합니다.
- 실물 단말이 없어 사고 세션은 모의 기록기(`EventSimulator`)로 만듭니다. 단말이 생기면 단말이 만든 .pel 을 같은 저장·업로드 경로로 넘기면 됩니다.
- 앱은 백그라운드 작업 없이 실행 중일 때만 자동 업로드합니다(앱을 다시 열면 대기 건을 올림).
- 경고음은 Android `ToneGenerator`(MainActivity.kt)로 냅니다. 무음 모드에서는 소리 없이 진동·화면 경고만 나갈 수 있습니다.
- 초대 API 요청 제한은 서버 인스턴스 메모리 기준이라 서버리스 환경에서는 느슨합니다(토큰은 256비트 난수라 추측 공격은 불가능).
