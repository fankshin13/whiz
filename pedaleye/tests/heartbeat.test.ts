import { describe, expect, it, vi } from "vitest";

import { pingHeartbeat } from "@/lib/server/heartbeat";
import { validateServerEnv } from "@/lib/server/env";

const ok: typeof fetch = () => Promise.resolve(new Response("OK", { status: 200 }));

describe("pingHeartbeat", () => {
  it("주소가 없으면 아무것도 보내지 않는다", async () => {
    const fetchImpl = vi.fn(ok);
    expect(await pingHeartbeat(null, "success", fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("성공은 주소 그대로, 실패는 /fail 을 붙여 보낸다", async () => {
    const fetchImpl = vi.fn(ok);
    await pingHeartbeat("https://hc-ping.com/abc", "success", fetchImpl);
    await pingHeartbeat("https://hc-ping.com/abc/", "fail", fetchImpl);
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(["https://hc-ping.com/abc", "https://hc-ping.com/abc/fail"]);
  });

  it("신호가 실패해도 예외를 던지지 않는다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(() => Promise.reject(new Error("network")));
    await expect(pingHeartbeat("https://hc-ping.com/abc", "success", fetchImpl)).resolves.toBe(false);
    expect(await pingHeartbeat("https://hc-ping.com/abc", "success", vi.fn(() => Promise.resolve(new Response("", { status: 404 }))))).toBe(false);
  });
});

describe("CRON_HEARTBEAT_URL", () => {
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    NEXT_PUBLIC_APP_TIMEZONE: "Asia/Seoul",
    APP_BASE_URL: "https://pedaleye.vercel.app",
  };
  it("선택이며 https 주소만 받는다", () => {
    expect(validateServerEnv(base).CRON_HEARTBEAT_URL).toBeUndefined();
    expect(validateServerEnv({ ...base, CRON_HEARTBEAT_URL: "" }).CRON_HEARTBEAT_URL).toBeUndefined();
    expect(validateServerEnv({ ...base, CRON_HEARTBEAT_URL: "https://hc-ping.com/abc" }).CRON_HEARTBEAT_URL).toBe("https://hc-ping.com/abc");
    expect(() => validateServerEnv({ ...base, CRON_HEARTBEAT_URL: "http://hc-ping.com/abc" })).toThrow(/CRON_HEARTBEAT_URL/);
  });
});
