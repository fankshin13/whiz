"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { loadSessionForensics } from "@/lib/forensics/session-forensics";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { createClient } from "@/lib/supabase/server";

export type ReverifyState = { message: string | null; ok: boolean | null };

/** 무결성 재검증: 원본 로그를 다시 계산하고 결과를 event_sessions.integrity_verified 에 맞춘다. */
export async function verifySessionIntegrityAction(sessionId: string): Promise<ReverifyState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "로그인이 필요합니다. 다시 로그인해 주세요." };

  // 권한은 사용자 클라이언트로 먼저 확인되고, 저장값 동기화에만 service_role 을 쓴다
  const result = await loadSessionForensics(await createClient(), user, sessionId, createAdminClient());
  if (!result.success) return { ok: false, message: result.error };

  revalidatePath(`/events/${sessionId}`);
  revalidatePath("/events");
  const { verification } = result.data;
  return {
    ok: verification.isValid,
    message: verification.isValid
      ? `재검증 완료: 무결성 검증 통과(변조 없음) · ${verification.totalRecords.toLocaleString("ko-KR")}개 · ${verification.verificationDurationMs}ms`
      : `재검증 완료: 해시 체인 불일치(변조 감지) · 패킷 #${verification.failureDetail?.failedSequenceId ?? "?"}`,
  };
}
