"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { RETENTION_CONFIRM_PHRASE } from "@/lib/audit/labels";
import { logAuditEvent } from "@/lib/audit/operations";
import { retentionErrorMessage, runAuditRetention } from "@/lib/audit/retention";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { clientIpFromHeaders } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { createClient } from "@/lib/supabase/server";

export type RetentionState = { ok: null } | { ok: false; error: string };

/** 보존 기간(1년)이 지난 감사 로그를 지금 아카이브하고 삭제한다(슈퍼 관리자). */
export async function runAuditRetentionAction(_prev: RetentionState, formData: FormData): Promise<RetentionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (user.role !== "super_admin") {
    await logAuditEvent(await createClient(), {
      action: "AUDIT_PURGE",
      targetType: "audit_archive",
      targetId: "-",
      summary: { reason: "슈퍼 관리자만 감사 로그를 정리할 수 있습니다." },
      status: "DENIED",
    });
    return { ok: false, error: "슈퍼 관리자만 감사 로그를 정리할 수 있습니다. 이 시도는 감사 로그에 기록되었습니다." };
  }
  if (String(formData.get("confirm") ?? "").trim() !== RETENTION_CONFIRM_PHRASE) {
    return { ok: false, error: `확인 문구 '${RETENTION_CONFIRM_PHRASE}'를 정확히 입력해 주세요.` };
  }

  const admin = createAdminClient(clientIpFromHeaders(await headers()));
  const result = await runAuditRetention(admin, { actorId: user.id });
  if (result.status === "failed") {
    console.error("manual audit retention failed", { step: result.step, error: result.error });
    return { ok: false, error: retentionErrorMessage(result.error) };
  }
  revalidatePath("/admin/audit");
  redirect(
    result.status === "nothing"
      ? "/admin/audit?notice=retention_nothing"
      : `/admin/audit?notice=retention_purged&count=${result.deleted}`,
  );
}
