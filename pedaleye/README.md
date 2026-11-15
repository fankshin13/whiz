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
