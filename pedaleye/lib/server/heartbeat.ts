/**
 * 외부 감시 서비스(예: Healthchecks.io)에 자동 작업 결과를 알린다.
 * 성공이면 주소 그대로, 실패면 주소 뒤에 /fail 을 붙여 GET 한다. 정해진 기간 안에 신호가 없으면 감시 서비스가 메일을 보낸다.
 * 신호 실패·지연이 작업 결과를 바꾸지 않도록 5초 제한, 예외는 삼키고 기록만 남긴다.
 */
export async function pingHeartbeat(
  url: string | null,
  outcome: "success" | "fail",
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!url) return false;
  const target = outcome === "fail" ? `${url.replace(/\/+$/, "")}/fail` : url;
  try {
    const response = await fetchImpl(target, { method: "GET", signal: AbortSignal.timeout(5_000), cache: "no-store" });
    if (!response.ok) console.error("heartbeat ping rejected", { status: response.status, outcome });
    return response.ok;
  } catch (error) {
    console.error("heartbeat ping failed", { outcome, message: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}
