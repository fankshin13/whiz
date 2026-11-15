import { describe, expect, it } from "vitest";

import { validateServerEnv } from "@/lib/server/env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  NEXT_PUBLIC_APP_TIMEZONE: "Asia/Seoul",
  APP_BASE_URL: "https://pedaleye.vercel.app/",
};

describe("validateServerEnv", () => {
  it("필수 값이 있으면 기본값을 채워 돌려준다(끝 슬래시 제거)", () => {
    expect(validateServerEnv(valid)).toMatchObject({
      APP_BASE_URL: "https://pedaleye.vercel.app",
      NTP_SERVER_HOST: "time.google.com",
      EVENT_BUFFER_WINDOW_SEC: 30,
      NODE_ENV: "production",
    });
  });

  it("누락·형식 오류는 변수 이름과 함께 막는다(값은 담지 않음)", () => {
    expect(() => validateServerEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: undefined })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => validateServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => validateServerEnv({ ...valid, NEXT_PUBLIC_APP_TIMEZONE: "UTC" })).toThrow(/NEXT_PUBLIC_APP_TIMEZONE/);
    expect(() => validateServerEnv({ ...valid, EVENT_BUFFER_WINDOW_SEC: "-1" })).toThrow(/EVENT_BUFFER_WINDOW_SEC/);
    try {
      validateServerEnv({ ...valid, APP_BASE_URL: "nope", SUPABASE_SERVICE_ROLE_KEY: "" });
    } catch (error) {
      expect(String(error)).not.toContain("anon");
    }
  });
});
