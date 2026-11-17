"use server";

import { revalidatePath } from "next/cache";

import { auditIfDenied } from "@/lib/audit/operations";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createOrgAdminInvitation, type CreateInvitationResult } from "@/lib/invitations/operations";
import { createOrganization, updateOrganization } from "@/lib/organizations/operations";
import { getAppBaseUrl } from "@/lib/server/env";
import { createClient } from "@/lib/supabase/server";

type OrgFormValues = { name: string; type: string };
export type OrganizationFormState =
  | { ok: null }
  | { ok: true; message: string }
  | { ok: false; error: string; values: OrgFormValues };

const LOGIN_REQUIRED = "로그인이 필요합니다. 다시 로그인해 주세요.";

function formValues(formData: FormData): OrgFormValues {
  return { name: String(formData.get("name") ?? "").slice(0, 50), type: String(formData.get("type") ?? "") };
}

/** 조직 생성·수정 공용(id 가 있으면 수정). 실패하면 입력값을 돌려줘 폼을 다시 채운다. */
export async function saveOrganizationAction(
  _prev: OrganizationFormState,
  formData: FormData,
): Promise<OrganizationFormState> {
  const values = formValues(formData);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: LOGIN_REQUIRED, values };

  const id = formData.get("id");
  const supabase = await createClient();
  const result =
    typeof id === "string" && id
      ? await updateOrganization(supabase, user, { id, ...values })
      : await createOrganization(supabase, user, values);
  if (!result.ok) {
    await auditIfDenied(supabase, result.error, { action: id ? "ORG_UPDATE" : "ORG_CREATE", targetType: "organization", targetId: typeof id === "string" ? id : null, targetName: values.name });
    return { ok: false, error: result.error, values };
  }

  revalidatePath("/admin/organizations");
  return { ok: true, message: id ? "조직 정보가 변경되었습니다." : "새로운 조직이 생성되었습니다." };
}

type InviteFormValues = { name: string; email: string; expiresInHours: string };
export type OrgAdminInvitationState =
  | Extract<CreateInvitationResult, { ok: true }>
  | { ok: false; error: string; values: InviteFormValues }
  | { ok: null };

export async function createOrgAdminInvitationAction(
  _prev: OrgAdminInvitationState,
  formData: FormData,
): Promise<OrgAdminInvitationState> {
  const values: InviteFormValues = {
    name: String(formData.get("name") ?? "").slice(0, 50),
    email: String(formData.get("email") ?? "").slice(0, 320),
    expiresInHours: String(formData.get("expiresInHours") ?? "24"),
  };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: LOGIN_REQUIRED, values };

  const supabase = await createClient();
  const result = await createOrgAdminInvitation(
    supabase,
    user,
    { orgId: formData.get("orgId"), ...values },
    getAppBaseUrl(),
  );
  if (!result.ok) {
    await auditIfDenied(supabase, result.error, { action: "INVITATION_CREATE", targetType: "invitation", targetName: values.name });
    return { ...result, values };
  }
  return result;
}
