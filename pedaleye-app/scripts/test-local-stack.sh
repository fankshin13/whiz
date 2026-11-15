#!/usr/bin/env bash
# 로컬 Supabase(supabase start)와 로컬 웹 서버(pedaleye/ 에서 pnpm start)가 떠 있을 때만 실행한다.
# 공개 anon 키만 쓴다. 테스트가 만든 계정·초대는 끝나면 로컬 DB 에서 지운다.
set -euo pipefail
cd "$(dirname "$0")/.."

SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
WEB_API_BASE_URL="${WEB_API_BASE_URL:-http://127.0.0.1:3000}"
case "$SUPABASE_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "로컬 주소에서만 실행합니다: $SUPABASE_URL" >&2; exit 1;; esac
ANON_KEY="$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' ../pedaleye/.env.local | cut -d= -f2-)"

cleanup() {
  docker exec -i supabase_db_pedaleye psql -U postgres -q -c "
    update public.vehicles set assigned_user_id = null where id = '30000000-0000-0000-0000-000000000004';
    delete from public.invitations where email like 'app-it-%@pedaleye.test';
    delete from auth.users where email like 'app-it-%@pedaleye.test';" >/dev/null
}
cleanup
trap cleanup EXIT

flutter test test_local \
  --dart-define=SUPABASE_URL="$SUPABASE_URL" \
  --dart-define=SUPABASE_ANON_KEY="$ANON_KEY" \
  --dart-define=WEB_API_BASE_URL="$WEB_API_BASE_URL"
