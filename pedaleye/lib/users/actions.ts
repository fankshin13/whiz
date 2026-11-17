"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auditIfDenied } from "@/lib/audit/operations";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { setUserActive, userFilterSchema } from "@/lib/users/operations";

export type SetActiveState = { ok: null } | { ok: false; error: string };

/** 계정 비활성화·재활성화·조직 관리자 강등(폼). */
export async function setUserActiveAction(_prev: SetActiveState, formData: FormData): Promise<SetActiveState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const userId = String(formData.get("userId") ?? "").slice(0, 64);
  const mode = String(formData.get("mode") ?? "");
  const active = mode === "reactivate";
  const demote = mode === "demote";
  const supabase = await createClient();
  const result = await setUserActive(supabase, user, {
    userId,
    active,
    demote,
    unassignVehicle: formData.get("unassignVehicle") === "on",
    reason: String(formData.get("reason") ?? "").slice(0, 300) || undefined,
  });
  if (!result.ok) {
    await auditIfDenied(supabase, result.error, {
      action: active ? "USER_REACTIVATE" : demote ? "USER_ROLE_CHANGE" : "USER_DEACTIVATE",
      targetType: "user",
      targetId: userId,
    });
    return { ok: false, error: result.error };
  }

  revalidatePath("/users");
  revalidatePath("/vehicles");
  // 행 모양이 바뀌어 대화상자가 사라지므로 결과는 목록 위 안내로 보여 준다(조회 조건 유지)
  const keep = userFilterSchema.parse(Object.fromEntries(new URLSearchParams(String(formData.get("returnQuery") ?? "").slice(0, 500))));
  const params = new URLSearchParams();
  for (const key of ["org", "role", "status", "q"] as const) if (keep[key]) params.set(key, String(keep[key]));
  if (keep.page > 1) params.set("page", String(keep.page));
  params.set("notice", active ? "reactivated" : demote ? "demoted" : "deactivated");
  if (result.unassigned.length) params.set("unassigned", result.unassigned.join(",").slice(0, 200));
  redirect(`/users?${params.toString()}`);
}
