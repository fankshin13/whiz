import { z } from "zod";

import { jsonResponse, readLimitedJson } from "@/lib/server/mobile-api";
import { lookupInvitation } from "@/lib/invitations/operations";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

const allow = createRateLimiter({ limit: 20, windowMs: 60_000 });
const bodySchema = z.object({ token: z.string().max(200) });

/** 공개: 초대 토큰 확인. 토큰 자체가 인가 수단이며 내부 ID·해시는 돌려주지 않는다. */
export async function POST(request: Request) {
  const read = await readLimitedJson(request, allow);
  if (!read.ok) return read.response;

  const parsed = bodySchema.safeParse(read.body);
  if (!parsed.success) return jsonResponse({ error: "INVALID_INPUT" }, 400);

  const invitation = await lookupInvitation(createAdminClient(), parsed.data.token.trim());
  if (!invitation.valid) return jsonResponse({ isValid: false, reason: invitation.reason });

  return jsonResponse({
    isValid: true,
    email: invitation.email,
    inviteeName: invitation.inviteeName,
    orgName: invitation.orgName,
    vehiclePlate: invitation.vehiclePlate,
  });
}
