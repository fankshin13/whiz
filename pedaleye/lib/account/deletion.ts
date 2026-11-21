import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

/** 화면에서 그대로 입력해야 하는 확인 문구 */
export const ACCOUNT_DELETION_CONFIRM = "계정 삭제";

export type DeletionResult = { ok: true } | { ok: false; error: string };

const INVALID = "이메일 또는 비밀번호가 올바르지 않습니다.";
const MESSAGES: Record<string, string> = {
  ALREADY_INACTIVE: "이미 비활성화된 계정입니다. 삭제 요청이 접수됐거나 관리자가 비활성화한 계정입니다.",
  SUPER_ADMIN_SELF: "슈퍼 관리자 계정은 다른 슈퍼 관리자가 처리해야 합니다.",
};

/**
 * 본인 계정 삭제 요청: 이메일·비밀번호로 본인을 다시 확인한 뒤 즉시 비활성화한다.
 * 쿠키를 쓰지 않는 일회용 클라이언트라 웹 로그인 상태와 무관하다(운전자도 웹에서 요청 가능).
 */
export async function requestOwnAccountDeletion(input: {
  email: string;
  password: string;
  reason?: string;
  clientIp?: string;
}): Promise<DeletionResult> {
  const { url, anonKey } = getSupabasePublicEnv();
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(input.clientIp ? { global: { headers: { "x-pedaleye-client-ip": input.clientIp } } } : {}),
  });

  const signIn = await client.auth.signInWithPassword({ email: input.email.trim(), password: input.password });
  if (signIn.error) {
    if (signIn.error.code === "user_banned") return { ok: false, error: MESSAGES.ALREADY_INACTIVE! };
    return { ok: false, error: INVALID };
  }

  const { error } = await client.rpc("request_account_deletion", { p_reason: input.reason?.slice(0, 150) || undefined });
  // 세션은 DB 함수가 이미 폐기했다. 이 클라이언트의 기억만 지운다
  await client.auth.signOut({ scope: "local" });
  if (error) {
    const key = Object.keys(MESSAGES).find((k) => error.message.includes(k));
    return { ok: false, error: (key && MESSAGES[key]) || "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  return { ok: true };
}
