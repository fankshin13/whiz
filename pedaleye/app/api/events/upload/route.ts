import { revalidatePath } from "next/cache";

import { uploadEventSession } from "@/lib/events/upload";
import { getBearerUser } from "@/lib/server/bearer-user";
import { jsonResponse, readLimitedJson } from "@/lib/server/mobile-api";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

const allow = createRateLimiter({ limit: 30, windowMs: 60_000 });
// 3,000개 × 64B + 32B 의 Base64(약 256KB) + JSON 여유
const MAX_BODY_BYTES = 300_000;

/**
 * 모바일 앱의 사고 세션(.pel) 업로드. 웹의 uploadEventSessionAction 과 같은 uploadEventSession 을 쓴다:
 * 로그인 사용자 권한 확인(본인 배정 차량 단말만) → 서버가 해시 체인 전수 검증 → service_role 로 저장.
 * 앱이 보낸 무결성 값은 받지 않는다(본문의 알 수 없는 필드는 무시).
 */
export async function POST(request: Request) {
  const read = await readLimitedJson(request, allow, MAX_BODY_BYTES);
  if (!read.ok) return read.response;

  const auth = await getBearerUser(request);
  if (!auth) return jsonResponse({ success: false, error: "로그인이 필요합니다. 다시 로그인해 주세요." }, 401);

  const result = await uploadEventSession(auth.client, createAdminClient(), auth.user, read.body);
  if (!result.success) return jsonResponse({ success: false, error: result.error }, result.status);

  if (!result.duplicate) {
    revalidatePath("/events");
    revalidatePath("/dashboard");
  }
  return jsonResponse(result);
}
