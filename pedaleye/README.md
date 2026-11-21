# 페달아이 MVP 웹 콘솔

## 로컬 개발

```bash
pnpm install
pnpm exec supabase start   # Docker 필요. 마이그레이션 + supabase/seed.sql 자동 적용
```

`pnpm exec supabase status -o env` 값으로 `.env.local`을 만듭니다(키 이름은 `.env.example` 참고, 커밋 금지).

```bash
pnpm dev
```

## 검사

| 명령 | 내용 |
| --- | --- |
| `pnpm check` | 타입 검사 · 린트 · 단위 테스트 · 빌드 |
| `pnpm test:db` | 로컬 Supabase 대상 RLS·인증 통합 테스트 |
| `pnpm db:types` | 로컬 스키마에서 `lib/supabase/database.types.ts` 재생성 |

## 테스트 계정 (로컬 시드 전용)

비밀번호는 모두 `Pedaleye-Test-2026!` 입니다.

| 이메일 | 역할 | 조직 |
| --- | --- | --- |
| super@pedaleye.test | super_admin | - |
| admin.hwaseong@pedaleye.test | org_admin | 화성시 교통안전과 |
| driver.a@pedaleye.test / driver.b@pedaleye.test | driver | 화성시 교통안전과 |
| investigator.hwaseong@pedaleye.test | investigator | 화성시 교통안전과 |
| admin.seoul@pedaleye.test | org_admin | 서울법인택시 |
| driver.c@pedaleye.test | driver | 서울법인택시 |

## 페달 캘리브레이션 — 모바일 앱(Flutter) 이식 안내

웹 콘솔 `/devices/calibrate`의 계산·진행 규칙은 화면과 분리돼 있어 그대로 옮기면 됩니다.

| 모듈 | 역할 | 앱에서 할 일 |
| --- | --- | --- |
| `lib/telemetry/displacement-engine.ts` | 거리(0.01mm) → 답입률(0~100%), 데드존 2%, 최소 가동 5mm, 3초 구간 이상치 제거·안정 판정 | Dart 로 1:1 이식(순수 함수) |
| `lib/calibration/wizard.ts` | 4단계 진행 상태 머신, 재측정·가동 범위 경고, 저장 계약 생성 | Dart 로 1:1 이식(순수 함수) |
| `lib/telemetry/sensor-source.ts` | 센서 입력 인터페이스(`subscribe`) + 웹 시뮬레이터 | 같은 인터페이스의 BLE 구현으로 교체 |
| `types/calibration.ts` | 데이터 계약 | 같은 필드로 모델 정의 |
| `lib/calibration/operations.ts` | 권한 확인 후 `devices` 보정값 저장 | Supabase 로 같은 UPDATE(RLS 가 운전자·관리자 범위 강제) |

단위 테스트(`tests/displacement-engine.test.ts`, `tests/calibration-wizard.test.ts`)의 입력·기대값을 앱 테스트에도 그대로 쓰면 같은 동작을 보장할 수 있습니다.

## 모바일 앱(`../pedaleye-app`)용 API

앱에는 서버 비밀 키가 없으므로 권한이 필요한 일은 이 웹 서버가 합니다. 세 API 모두 IP당 분당 요청 수를 제한합니다.

| 요청 | 인증 | 하는 일 |
| --- | --- | --- |
| `POST /api/invitations/verify` | 없음(1회용 토큰) | 초대 확인 → 조직·차량·이메일 |
| `POST /api/invitations/accept` | 없음(1회용 토큰) | 운전자 계정 생성·차량 배정(웹 초대 수락과 같은 로직) |
| `POST /api/events/upload` | `Authorization: Bearer <Supabase 액세스 토큰>` | 사고 세션(.pel) 업로드. 웹 업로드와 같은 `uploadEventSession`(본인 배정 차량 단말만 → 서버 해시 체인 전수 검증 → service_role 저장, 같은 세션은 중복 생성 안 함) |

## 운전자의 사고 기록 열람

운전자는 `/events`(목록), `/events/[id]`(무결성 검증 결과), `/events/[id]/report`(PDF 보고서)를 **지금 본인에게 배정된 차량의 세션만** 볼 수 있습니다.
DB(RLS: 배정 차량 → 단말 → 세션·원본 파일)와 `loadSessionForensics`(배정 운전자 확인)가 이중으로 막습니다. 차량 배정이 바뀌면 이전 차량 기록은 더 이상 보이지 않습니다.

## 운영 배포 (Vercel + Supabase)

### 1. 운영 Supabase
1. supabase.com 에서 새 프로젝트를 만든다(리전 Seoul `ap-northeast-2` 권장).
2. 마이그레이션 적용 — 둘 중 하나:
   - CLI: `pnpm exec supabase link --project-ref <ref>` 후 `pnpm exec supabase db push` (시드는 넣지 않는다)
   - 대시보드 SQL Editor: `supabase/migrations/` 의 모든 파일을 번호 순서대로 실행
3. Authentication 설정
   - URL Configuration → Site URL = 서비스 주소(`APP_BASE_URL`)
   - Email → 최소 비밀번호 길이 8
   - 일반 가입 끄기 권장(Allow new users to sign up 해제). 운전자는 초대 링크로만 가입하며, 초대 수락은 서버가 관리자 API로 계정을 만들므로 영향이 없다.
4. 점검: SQL Editor 에서 `supabase/audit/production-audit.sql` 실행 → 모든 행의 `ok` 가 `true` 인지 확인
5. 첫 슈퍼 관리자: Authentication → Users → Add user 로 계정을 만든 뒤 SQL Editor 에서
   `update public.users set role = 'super_admin' where email = '<이메일>';`
   이후 조직은 웹 **조직 관리**(`/admin/organizations`)에서 만들고, 조직마다 **관리자 초대**로 조직 관리자(org_admin)를 1회용 링크로 붙인다.
   조직 관리자 초대는 슈퍼 관리자만 만들 수 있다(DB 정책 `invitations_insert` 가 한 번 더 막음). 조직 관리자는 자기 조직의 운전자만 초대한다.
   단말은 웹 **단말 관리**(`/devices`)에서 슈퍼 관리자가 조직을 정해 재고로 등록하고, 조직 관리자가 자기 조직 차량에 장착·교체·해제한다.
   재고는 조직별이다(다른 조직 재고는 보이지 않음). 교체·해제된 단말은 그 조직 재고로 돌아가고, 새로 장착한 단말은 보정값이 공장 기본값으로 초기화되어 '보정 필요'로 표시된다.
   장착·교체는 DB 함수 `mount_device` 가 권한 확인과 함께 한 번에 처리한다. 점검 SQL 의 `devices_without_org` 가 `false` 면 조직이 정해지지 않은 기존 단말이 있다는 뜻이다(슈퍼 관리자만 보이며, 장착하면 그 차량 조직으로 정해짐).
   단말 인증 공개키(Ed25519, 출하 정보)는 단말 등록 때 넣거나 단말 관리의 **인증 키 등록·교체**로 슈퍼 관리자가 넣는다(교체·해제는 사유 필수, 감사 로그 기록). 키가 없는 단말은 '인증 미설정(시험 단말)'로 표시되며 BLE 규격은 `docs/ble-protocol.md` 를 따른다.
   단말이 BLE 로 넘긴 사고 기록은 단말 봉인 서명과 일련번호 기준 해시 체인으로 검증되며, 상세 화면에 '단말 봉인 서명 확인 / 불일치 / 없음(앱 생성 기록)'으로 표시된다.
   관리 작업(조직·차량·단말·초대·사용자 변경)과 사고 보고서 열람·인쇄는 감사 로그(`public.audit_logs`)에 자동으로 남고 웹 **감사 로그**(`/admin/audit`)에서 조회·CSV 내보내기를 한다(슈퍼 관리자 전체, 조직 관리자 자기 조직).
   감사 로그는 추가만 되며 서비스 키로도 수정·삭제할 수 없다(트리거). 요청 IP 는 웹 서버가 `x-pedaleye-client-ip` 로 넘긴 값(Vercel 의 접속자 IP)이다.
   퇴사·담당 변경은 웹 **사용자 관리**(`/users`)에서 계정을 비활성화한다(삭제 없음, 재활성화 가능). DB 함수 `set_user_active` 가 상태 변경·차량 배정 해제·로그인 차단(`auth.users.banned_until`)·세션 폐기·감사 기록을 한 번에 처리하고, 비활성 계정은 권한 함수가 null 을 돌려 이미 받은 토큰으로도 데이터를 못 본다.
   **배포 순서**: 마이그레이션을 먼저 적용한 뒤 웹·새 앱을 배포한다(앱이 `users.is_active`·`devices.auth_public_key` 를 읽음).
   대기 중인 초대는 **사용자 관리 → 초대** 탭(또는 차량 상세)에서 취소·재발급한다. 재발급은 기존 링크를 취소하고 새 링크를 만들며, 취소된 링크는 웹·앱 모두에서 수락이 막힌다.
   이미 가입한 운전자는 차량 상세의 **기존 운전자 배정**으로 바로 배정한다(같은 조직의 미배정 활성 운전자만, 사유는 감사 로그). 다른 차량에서 옮기려면 그 차량의 배정을 먼저 해제하고, 차량에 대기 초대가 있으면 먼저 취소한다. 한 운전자는 차량 하나에만 배정된다(`uq_vehicles_assigned_user`).
   사고조사관은 **사용자 관리 → 조사관 초대**로 1회용 링크를 만들어 PC 웹에서 가입시킨다(차량 없음, 소속 조직 사고 기록만 열람). 앱은 조사관 초대를 받으면 웹 이용을 안내한다.

### 2. Vercel
1. 새 프로젝트, Root Directory = `pedaleye`, Framework = Next.js (`vercel.json` 이 서울 리전 `icn1`·pnpm 을 지정)
   - Git 연결 시 운영 브랜치 = `master`. `vercel.json` 의 `ignoreCommand` 가 미리보기(`VERCEL_ENV=preview`)로 확실히 표시된 배포만 빌드를 건너뛰게 해 미리보기 배포를 끈다(값이 비어 있으면 빌드한다 — 운영 배포가 막히지 않도록)(환경 변수가 Production 에만 있으므로). 미리보기가 필요해지면 이 줄을 지우고 Preview 용 환경 변수(별도 Supabase)를 넣는다.
   - **확인 필수**: Vercel 프로젝트 Settings → Git 의 **Production Branch 가 `master`** 여야 한다. 다르면 `master` 병합도 미리보기로 분류돼 빌드가 건너뛰어진다(GitHub 상태에 "Canceled by Ignored Build Step"). 이렇게 건너뛴 배포는 Redeploy 해도 미리보기로 남으므로, 설정을 고친 뒤 `master` 에 새 커밋을 올리거나 대시보드에서 `master` 로 새 배포를 만든다.
2. Environment Variables(Production) — 값은 Supabase 대시보드 Project Settings → API 에서 복사

   | 이름 | 값 | 비고 |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | 공개 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon(publishable) 키 | 공개 |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role(secret) 키 | **Sensitive 로 등록**, 절대 `NEXT_PUBLIC_` 접두사 금지 |
   | `NEXT_PUBLIC_APP_TIMEZONE` | `Asia/Seoul` | |
   | `APP_BASE_URL` | `https://<프로젝트>.vercel.app` | 초대 링크·보고서 QR 주소 |
   | `NTP_SERVER_HOST` | `time.google.com` | |
   | `EVENT_BUFFER_WINDOW_SEC` | `30` | |
   | `PRIVACY_CONTROLLER` · `PRIVACY_OFFICER` · `PRIVACY_CONTACT` · `PRIVACY_EFFECTIVE_DATE` | 회사명 · 보호책임자(성명·직책) · 연락처 · 시행일(YYYY-MM-DD) | `/privacy` 개인정보처리방침 게시 정보. 넷 다 있어야 공개(없으면 '준비 중') |
   | `CRON_HEARTBEAT_URL` | Healthchecks.io 핑 주소(`https://hc-ping.com/…`) | 선택. 자동 정리 결과 신호(아래 "운영 알림") |
   | `CRON_SECRET` | 무작위 32자 이상 | **Sensitive**. 보관 기간 자동 작업(매월 2일 03:10, `vercel.json` crons): 감사 로그 1년 아카이브 후 삭제, 계정 비활성화 후 1년 익명화, 사고 기록 3년 파기(법적 보존 제외). 없으면 자동 정리만 꺼진다 |

   하나라도 빠지거나 형식이 틀리면 Vercel 빌드가 `[CRITICAL]` 오류로 실패한다(설정이 틀린 배포 차단).
3. 배포 후 확인
   - `https://<주소>/api/health` → HTTP 200, `{"status":"healthy","database":"connected","timezone":"Asia/Seoul"}`
   - 첫 슈퍼 관리자로 로그인 → 조직·차량 등록 → 운전자 초대 링크 발급

## 운영 알림(메일)

앱은 메일을 직접 보내지 않는다. 외부 무료 감시 서비스가 신호를 지켜보다가 이상하면 메일을 보낸다. 받는 메일 주소는 감시 서비스에만 넣고 저장소에는 남기지 않는다.

| 감시 대상 | 서비스 | 설정 | 알림 조건 |
| --- | --- | --- | --- |
| 보관 기간 자동 작업(매월) | [Healthchecks.io](https://healthchecks.io) | Schedule = Cron `10 18 1 * *`, Time zone `UTC`, Grace Time 1일 → 핑 주소를 Vercel `CRON_HEARTBEAT_URL` 에 넣고 Redeploy | 실패하면 즉시(`/fail` 신호), 실행되지 않으면 유예 시간 뒤 |
| 서버 상태 `/api/health` | [UptimeRobot](https://uptimerobot.com) | HTTP(s) 모니터, 주소 `https://<주소>/api/health`, 간격 5분 | 200 이 아니면(이상 시 503) |

`/api/health` 감시는 5분마다 DB 를 한 번 조회하므로, 무료 Supabase 프로젝트가 장기간 접속이 없어 일시 중지되는 것도 막는다.
