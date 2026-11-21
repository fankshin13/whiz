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

export type LegalHoldState = { ok: null } | { ok: false; error: string };

/** 법적 보존 표시·해제(슈퍼 관리자, 표시할 때 사유 필수). 표시된 기록은 3년 보관 기간이 지나도 파기되지 않는다. */
export async function setLegalHoldAction(_prev: LegalHoldState, formData: FormData): Promise<LegalHoldState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다. 다시 로그인해 주세요." };
  if (user.role !== "super_admin") return { ok: false, error: "슈퍼 관리자만 법적 보존을 바꿀 수 있습니다." };
  const sessionId = String(formData.get("sessionId") ?? "").slice(0, 64);
  const hold = formData.get("hold") === "true";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (hold && !reason) return { ok: false, error: "보존 사유를 입력해 주세요. 예: 사건번호, 소송·수사 기관" };

  const { error } = await (await createClient()).rpc("set_event_legal_hold", { p_session_id: sessionId, p_hold: hold, p_reason: reason || undefined });
  if (error) {
    console.error("legal hold update failed", { code: error.code });
    return { ok: false, error: "법적 보존 상태를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  revalidatePath(`/events/${sessionId}`);
  return { ok: null };
}
