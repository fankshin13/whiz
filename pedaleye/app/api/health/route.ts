import { NextResponse } from "next/server";

import packageJson from "@/package.json";
import { toSeoulIso } from "@/lib/forensics/integrity-engine";
import { validateServerEnv } from "@/lib/server/env";
import { createAdminClient } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

const CACHE_MS = 10_000; // 공개 엔드포인트: DB 확인은 10초에 한 번만
let cached: { at: number; ok: boolean; reason?: string } | null = null;

type Reason = "CONFIGURATION_INVALID" | "DATABASE_UNAVAILABLE" | "TIMEZONE_MISMATCH";

async function check(): Promise<{ ok: boolean; reason?: Reason }> {
  let timezone: string;
  try {
    timezone = validateServerEnv().NEXT_PUBLIC_APP_TIMEZONE;
  } catch (error) {
    console.error("health: configuration invalid", { message: error instanceof Error ? error.message : "unknown" });
    return { ok: false, reason: "CONFIGURATION_INVALID" };
  }
  if (new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone !== "Asia/Seoul") {
    return { ok: false, reason: "TIMEZONE_MISMATCH" };
  }
  // 응답에는 건수 등 데이터 없이 연결 여부만 담는다
  const { error } = await createAdminClient().from("organizations").select("id", { head: true, count: "exact" }).limit(1);
  if (error) {
    console.error("health: database check failed", { code: error.code });
    return { ok: false, reason: "DATABASE_UNAVAILABLE" };
  }
  return { ok: true };
}

/** 공개 상태 확인. 내부 정보는 노출하지 않는다. */
export async function GET() {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_MS) cached = { at: now, ...(await check()) };
  const timestamp = toSeoulIso(now);
  const headers = { "Cache-Control": "no-store" };

  if (!cached.ok) {
    return NextResponse.json({ status: "unhealthy", timestamp, reason: cached.reason }, { status: 503, headers });
  }
  return NextResponse.json(
    { status: "healthy", timestamp, timezone: "Asia/Seoul", database: "connected", version: packageJson.version },
    { headers },
  );
}
