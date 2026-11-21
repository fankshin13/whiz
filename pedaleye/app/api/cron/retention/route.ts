import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { runAuditRetention } from "@/lib/audit/retention";
import { runRecordRetention } from "@/lib/retention/records";
import { getCronHeartbeatUrl, getCronSecret } from "@/lib/server/env";
import { pingHeartbeat } from "@/lib/server/heartbeat";
import { createAdminClient } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * 보관 기간 자동 작업(Vercel Cron, 매월 2일 03:10 KST).
 * 1) 감사 로그: 1년 경과분 아카이브 후 삭제  2) 계정: 비활성화 후 1년 익명화  3) 사고 기록: 생성 후 3년 파기(법적 보존 제외)
 * CRON_SECRET 이 없으면 꺼져 있다(503). 결과에는 건수와 단계만 담는다.
 * CRON_HEARTBEAT_URL 이 있으면 결과를 외부 감시 서비스에 알린다(하나라도 실패하면 실패 신호).
 */
export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_DISABLED" }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const admin = createAdminClient("VERCEL_CRON");
  const audit = await runAuditRetention(admin, { actorId: null });
  const records = await runRecordRetention(admin);
  const failed = audit.status === "failed" || records.status === "failed" || (records.status === "ok" && records.skippedEvents > 0);
  await pingHeartbeat(getCronHeartbeatUrl(), failed ? "fail" : "success");

  if (audit.status === "failed") console.error("audit retention failed", { step: audit.step, error: audit.error });
  if (records.status === "failed") console.error("record retention failed", { step: records.step, error: records.error });

  return NextResponse.json(
    {
      ok: !failed,
      audit: audit.status === "purged" ? { status: audit.status, archived: audit.rowCount, deleted: audit.deleted } : { status: audit.status },
      records:
        records.status === "ok"
          ? { status: "ok", anonymizedAccounts: records.anonymizedAccounts, purgedEvents: records.purgedEvents, skippedEvents: records.skippedEvents }
          : { status: "failed", step: records.step },
    },
    { status: failed ? 500 : 200 },
  );
}
