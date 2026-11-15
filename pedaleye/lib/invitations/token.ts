import "server-only";

import { createHash, randomBytes } from "node:crypto";

/** 32바이트 난수 토큰(hex 64자). 원문은 링크에만 담고 DB 에는 해시만 저장한다. */
export function generateInvitationToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedToken(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}
