import type { SupabaseClient } from "@supabase/supabase-js";

import { EVENT_LOG_BUCKET } from "@/lib/events/upload";
import type { Database } from "@/lib/supabase/database.types";

/**
 * 보관 기간 자동 파기(service_role 전용, 매월).
 * - 계정: 비활성화 후 1년 → 익명화(DB 함수)
 * - 사고 기록: 생성 후 3년(법적 보존 표시 제외) → 원본 파일을 먼저 지우고 행을 지운다.
 *   파일 삭제에 실패한 기록은 행을 남겨 다음 달에 다시 시도한다(개인정보가 담긴 파일이 고아로 남지 않게).
 */
type Client = SupabaseClient<Database>;

export type RecordRetentionResult =
  | { status: "ok"; anonymizedAccounts: number; purgedEvents: number; skippedEvents: number }
  | { status: "failed"; step: "accounts" | "events"; error: string; anonymizedAccounts: number; purgedEvents: number };

const BATCH = 200;
const MAX_BATCHES = 10; // 한 번 실행에 최대 2,000건(남으면 다음 달)

export async function runRecordRetention(admin: Client): Promise<RecordRetentionResult> {
  const accounts = await admin.rpc("anonymize_expired_accounts");
  if (accounts.error) return { status: "failed", step: "accounts", error: accounts.error.message, anonymizedAccounts: 0, purgedEvents: 0 };
  const anonymizedAccounts = accounts.data ?? 0;

  let purgedEvents = 0;
  let skippedEvents = 0;
  const failed = new Set<string>();
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data: expired, error } = await admin.rpc("list_expired_event_sessions", { p_limit: BATCH + failed.size });
    if (error) return { status: "failed", step: "events", error: error.message, anonymizedAccounts, purgedEvents };
    const todo = (expired ?? []).filter((row) => !failed.has(row.id));
    if (todo.length === 0) break;

    const paths = todo.flatMap((row) => (row.raw_log_storage_path ? [row.raw_log_storage_path] : []));
    if (paths.length > 0) {
      const removed = await admin.storage.from(EVENT_LOG_BUCKET).remove(paths);
      if (removed.error) {
        // 이번 묶음은 행을 남긴다(다음 달 재시도)
        for (const row of todo) failed.add(row.id);
        skippedEvents += todo.length;
        continue;
      }
    }
    const purged = await admin.rpc("purge_event_sessions", { p_ids: todo.map((row) => row.id) });
    if (purged.error) return { status: "failed", step: "events", error: purged.error.message, anonymizedAccounts, purgedEvents };
    purgedEvents += purged.data ?? 0;
    if (todo.length < BATCH) break;
  }
  return { status: "ok", anonymizedAccounts, purgedEvents, skippedEvents };
}
