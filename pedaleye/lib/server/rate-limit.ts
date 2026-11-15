import "server-only";

/**
 * 공개 엔드포인트용 고정 창(fixed window) 요청 제한.
 * 서버 인스턴스 메모리에 기록하므로 인스턴스마다 따로 센다(서버리스에서는 '느슨한 제한').
 * 초대 토큰은 256비트 난수라 대입 공격 자체는 불가능하고, 이 제한은 남용·부하를 줄이는 용도다.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function allow(key: string, now = Date.now()): boolean {
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      // 오래된 기록이 쌓이지 않도록 가끔 정리한다
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      }
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

/** 요청자 IP. Vercel 은 x-forwarded-for 첫 값을 실제 클라이언트로 채운다. */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
