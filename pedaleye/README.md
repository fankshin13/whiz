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
