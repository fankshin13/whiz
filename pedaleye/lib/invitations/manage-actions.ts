"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auditIfDenied } from "@/lib/audit/operations";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { safeInternalPath } from "@/lib/auth/roles";
import { reissueInvitation, revokeInvitation } from "@/lib/invitations/management";
import { getAppBaseUrl } from "@/lib/server/env";
import { createClient } from "@/lib/supabase/server";

/** 돌아갈 화면: 사용자 관리(초대 탭) 또는 차량 상세만 허용 */
function returnPath(value: FormDataEntryValue | null): string {
  const path = safeInternalPath(typeof value === "string" ? value.slice(0, 300) : null);
  return path && (/^\/users(\?|$)/.test(path) || /^\/vehicles\/[0-9a-f-]{36}(\?|$)/.test(path)) ? path : "/users?tab=invitations";
}

function withNotice(path: string, notice: string): string {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("notice", notice);
  return `${base}?${params.toString()}`;
}

export type RevokeInvitationState = { ok: null } | { ok: false; error: string };

/** 초대 취소(확인 대화상자). 성공하면 원래 화면으로 돌아가 안내한다. */
export async function revokeInvitationAction(_prev: RevokeInvitationState, formData: FormData): Promise<RevokeInvitationState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const invitationId = String(formData.get("invitationId") ?? "").slice(0, 64);
  const supabase = await createClient();
  const result = await revokeInvitation(supabase, user, { invitationId, reason: String(formData.get("reason") ?? "").slice(0, 200) || undefined });
  if (!result.ok) {
    await auditIfDenied(supabase, result.error, { action: "INVITATION_CANCEL", targetType: "invitation", targetId: invitationId });
    return { ok: false, error: `초대를 취소할 수 없습니다: ${result.error}` };
  }
  revalidatePath("/users");
  revalidatePath("/vehicles");
  redirect(withNotice(returnPath(formData.get("returnTo")), "invitation_revoked"));
}

export type ReissueInvitationState =
  | { ok: null }
  | { ok: true; invitationUrl: string; expiresAt: string; expiresInHours: number }
  | { ok: false; error: string };

/** 링크 재발급. 새 링크를 보여 줘야 하므로 화면 갱신은 관리자가 창을 닫을 때 클라이언트에서 한다. */
export async function reissueInvitationAction(_prev: ReissueInvitationState, formData: FormData): Promise<ReissueInvitationState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const invitationId = String(formData.get("invitationId") ?? "").slice(0, 64);
  const supabase = await createClient();
  const result = await reissueInvitation(supabase, user, { invitationId, expiresInHours: formData.get("expiresInHours") ?? 24 }, getAppBaseUrl());
  if (!result.ok) {
    await auditIfDenied(supabase, result.error, { action: "INVITATION_CREATE", targetType: "invitation", targetId: invitationId });
    return { ok: false, error: result.error };
  }
  return result;
}
