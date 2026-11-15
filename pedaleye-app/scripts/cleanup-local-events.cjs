// 로컬 통합 검사(test_local/events_test.dart)가 만든 사고 세션과 원본 파일을 지운다. 로컬 Supabase 전용.
// 원본 파일은 SQL 로 지울 수 없어 Storage API 를 쓴다. 키는 웹 프로젝트의 .env.local(로컬 데모 키)에서 읽는다.
const path = require("node:path");
const web = path.resolve(__dirname, "../../pedaleye");
process.loadEnvFile(path.join(web, ".env.local"));
const { createClient } = require(path.join(web, "node_modules/@supabase/supabase-js"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
  console.error("로컬 Supabase 에서만 실행합니다.");
  process.exit(1);
}
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const { data, error } = await admin
    .from("event_sessions")
    .select("id, raw_log_storage_path")
    .gte("start_time", "2026-11-14T00:58:00Z")
    .lt("start_time", "2026-11-14T01:15:00Z");
  if (error) throw new Error(`조회 실패 ${error.code}`);
  const paths = data.map((row) => row.raw_log_storage_path).filter(Boolean);
  if (paths.length) {
    const removed = await admin.storage.from("event-logs").remove(paths);
    if (removed.error) throw new Error(`원본 삭제 실패 ${removed.error.message}`);
  }
  if (data.length) {
    const deleted = await admin.from("event_sessions").delete().in("id", data.map((row) => row.id));
    if (deleted.error) throw new Error(`세션 삭제 실패 ${deleted.error.code}`);
  }
})();
