"use server";

import { z } from "zod";

import { logAuditEvent } from "@/lib/audit/operations";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";

/** 보고서 인쇄 창(PDF 저장)을 열었을 때 기록한다. 열람 권한은 DB 가 세션 소속으로 다시 확인하지 않으므로 세션 조회로 확인한다. */
export async function logReportPrintAction(sessionId: string): Promise<void> {
  const id = z.guid().safeParse(sessionId);
  if (!id.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const supabase = await createClient();
  // RLS 로 볼 수 있는 세션만 기록(남의 세션 ID 로 거짓 기록을 남기지 못하게)
  const { data } = await supabase.from("event_sessions").select("id").eq("id", id.data).maybeSingle();
  if (!data) return;
  await logAuditEvent(supabase, { action: "REPORT_DOWNLOAD", targetType: "event_report", targetId: id.data, targetName: `사고 세션 ${id.data.slice(0, 8)}` });
}
