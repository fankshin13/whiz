"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auditIfDenied } from "@/lib/audit/operations";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { postLoginPath } from "@/lib/auth/roles";
import { acceptInvitation, createInvitation, type CreateInvitationResult } from "@/lib/invitations/operations";
import { getAppBaseUrl } from "@/lib/server/env";
import { clientIpFromHeaders } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { createClient } from "@/lib/supabase/server";

type InviteFormValues = { name: string; email: string; expiresInHours: string };
export type CreateInvitationState =
  | Extract<CreateInvitationResult, { ok: true }>
  | { ok: false; error: string; values: InviteFormValues }
  | { ok: null };

export async function createInvitationAction(
  _prev: CreateInvitationState,
  formData: FormData,
): Promise<CreateInvitationState> {
  // 실패 시 폼이 초기화되므로 입력값을 돌려줘 다시 채운다
  const values: InviteFormValues = {
    name: String(formData.get("name") ?? "").slice(0, 50),
    email: String(formData.get("email") ?? "").slice(0, 320),
    expiresInHours: String(formData.get("expiresInHours") ?? "24"),
  };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다. 다시 로그인해 주세요.", values };

  const supabase = await createClient();
  const result = await createInvitation(
    supabase,
    user,
    {
      vehicleId: formData.get("vehicleId"),
      name: values.name,
      email: values.email,
      expiresInHours: values.expiresInHours,
    },
    getAppBaseUrl(),
  );
  // 목록 갱신은 관리자가 링크를 복사하고 창을 닫을 때 클라이언트에서 한다(즉시 갱신하면 모달이 사라짐).
  if (!result.ok) {
    await auditIfDenied(supabase, result.error, { action: "INVITATION_CREATE", targetType: "invitation", targetName: values.name });
    return { ...result, values };
  }
  return result;
}

export type AcceptInvitationState = { error: string | null };

const INVALID_LINK =
  "유효하지 않거나 이미 사용이 완료된 초대 링크입니다. 소속 운수사 또는 지자체 관리자에게 링크 재발급을 요청해주세요.";

const ACCEPT_ERRORS: Record<string, string> = {
  NOT_FOUND: INVALID_LINK,
  ALREADY_USED: INVALID_LINK,
  EXPIRED: "초대 링크의 유효기간이 지났습니다. 소속 운수사 또는 지자체 관리자에게 링크 재발급을 요청해주세요.",
  EMAIL_EXISTS: "이미 가입된 이메일입니다. 로그인 화면에서 기존 비밀번호로 로그인해 주세요.",
  VEHICLE_UNAVAILABLE: "배정 예정 차량에 이미 다른 운전자가 배정되었습니다. 관리자에게 문의해 주세요.",
  FAILED: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};

export async function acceptInvitationAction(
  _prev: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  const result = await acceptInvitation(createAdminClient(clientIpFromHeaders(await headers())), {
    token: formData.get("token"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });

  if (!result.ok) {
    return { error: result.error ?? ACCEPT_ERRORS[result.reason] ?? ACCEPT_ERRORS.FAILED ?? null };
  }

  // 방금 설정한 비밀번호로 세션 쿠키 발급
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: result.email,
    password: String(formData.get("password")),
  });
  if (error) {
    console.error("accept invitation sign-in failed", { status: error.status, code: error.code });
    return { error: "계정 등록은 완료됐지만 자동 로그인에 실패했습니다. 로그인 화면에서 설정한 비밀번호로 로그인해 주세요." };
  }

  revalidatePath("/", "layout");
  redirect(postLoginPath(result.role, null));
}
