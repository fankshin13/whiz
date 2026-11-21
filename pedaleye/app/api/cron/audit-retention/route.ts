import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { runAuditRetention } from "@/lib/audit/retention";
import { getCronSecret } from "@/lib/server/env";
import { createAdminClient } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * 감사 로그 보존 자동 실행(Vercel Cron, 매월). 1년이 지난 기록을 아카이브한 뒤 삭제한다.
 * CRON_SECRET 이 없으면 꺼져 있다(503). 결과에는 건수와 단계만 담는다.
 */
export async function GET(request: Request) {
  const secret = getCronSecret();
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_DISABLED" }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const result = await runAuditRetention(createAdminClient("VERCEL_CRON"), { actorId: null });
  if (result.status === "failed") {
    console.error("audit retention failed", { step: result.step, error: result.error });
    return NextResponse.json({ ok: false, status: result.status, step: result.step, cutoff: result.cutoff }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    status: result.status,
    cutoff: result.cutoff,
    ...(result.status === "purged" ? { archived: result.rowCount, deleted: result.deleted } : {}),
  });
}
