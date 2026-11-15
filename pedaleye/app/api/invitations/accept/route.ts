import { z } from "zod";

import { jsonResponse, readLimitedJson } from "@/lib/server/mobile-api";
import { acceptInvitation } from "@/lib/invitations/operations";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

const allow = createRateLimiter({ limit: 10, windowMs: 60_000 });
const bodySchema = z.object({ token: z.string().max(200), password: z.string().max(200) });

/**
 * 공개: 유효한 1회용 토큰 소지자만 계정을 만든다. 웹 초대 수락과 같은 acceptInvitation 을 쓴다.
 * 세션은 발급하지 않는다. 앱이 돌려받은 이메일과 방금 정한 비밀번호로 직접 로그인한다.
 */
export async function POST(request: Request) {
  const read = await readLimitedJson(request, allow);
  if (!read.ok) return read.response;

  const parsed = bodySchema.safeParse(read.body);
  if (!parsed.success) return jsonResponse({ success: false, error: "INVALID_INPUT" }, 400);

  const { token, password } = parsed.data;
  // 비밀번호 확인 일치는 앱 화면에서 검사한다
  const result = await acceptInvitation(createAdminClient(), { token: token.trim(), password, passwordConfirm: password });

  if (!result.ok) {
    const status = result.reason === "FAILED" ? 500 : 400;
    return jsonResponse({ success: false, error: result.reason, ...(result.error ? { message: result.error } : {}) }, status);
  }
  return jsonResponse({ success: true, email: result.email, role: result.role });
}
