import "server-only";

import { NextResponse } from "next/server";

import { clientIp } from "@/lib/server/rate-limit";

/**
 * 모바일 앱용 초대 API 공통 처리. 앱에는 service_role 키가 없으므로
 * 웹 서버가 토큰을 검증하고 계정을 만든다(로직은 operations.ts 를 그대로 쓴다).
 */
const MAX_BODY_BYTES = 4_096;
const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export type ParsedBody = { ok: true; body: unknown } | { ok: false; response: NextResponse };

/** 요청 제한 → 크기 제한 → JSON 파싱. 실패하면 바로 돌려줄 응답을 준다. */
export async function readLimitedJson(request: Request, allow: (key: string) => boolean): Promise<ParsedBody> {
  if (!allow(clientIp(request))) {
    return { ok: false, response: jsonResponse({ error: "RATE_LIMITED" }, 429) };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { ok: false, response: jsonResponse({ error: "PAYLOAD_TOO_LARGE" }, 413) };
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: jsonResponse({ error: "INVALID_INPUT" }, 400) };
  }
}
