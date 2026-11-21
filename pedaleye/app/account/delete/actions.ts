"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { ACCOUNT_DELETION_CONFIRM, requestOwnAccountDeletion } from "@/lib/account/deletion";
import { clientIpFromHeaders, createRateLimiter } from "@/lib/server/rate-limit";

export type DeletionState = { status: "idle" | "done" } | { status: "error"; error: string; email: string };

const allow = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 });

const schema = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
  confirm: z.literal(ACCOUNT_DELETION_CONFIRM),
  reason: z.string().max(150).optional(),
});

/** 공개 페이지의 계정 삭제 요청. 비밀번호로 본인 확인 후 즉시 비활성화한다. */
export async function requestDeletionAction(_prev: DeletionState, formData: FormData): Promise<DeletionState> {
  const email = String(formData.get("email") ?? "").slice(0, 320);
  const ip = clientIpFromHeaders(await headers());
  if (!allow(ip)) return { status: "error", error: "요청이 너무 많습니다. 15분 뒤 다시 시도해 주세요.", email };

  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: String(formData.get("confirm") ?? "").trim(),
    reason: String(formData.get("reason") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    const confirmWrong = parsed.error.issues.some((issue) => issue.path[0] === "confirm");
    return {
      status: "error",
      error: confirmWrong ? `확인 문구 '${ACCOUNT_DELETION_CONFIRM}'를 정확히 입력해 주세요.` : "이메일 또는 비밀번호가 올바르지 않습니다.",
      email,
    };
  }

  const result = await requestOwnAccountDeletion({ ...parsed.data, clientIp: ip });
  if (!result.ok) return { status: "error", error: result.error, email };
  return { status: "done" };
}
