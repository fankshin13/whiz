import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("프로젝트 기본 세팅", () => {
  it(".env.example에 필수 키가 값 없이 정의되어 있다", () => {
    const lines = readFileSync(".env.example", "utf8")
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#"));
    const entries = new Map(lines.map((line) => line.split("=", 2) as [string, string]));

    for (const key of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_APP_TIMEZONE",
      "NTP_SERVER_HOST",
      "EVENT_BUFFER_WINDOW_SEC",
    ]) {
      expect(entries.has(key), key).toBe(true);
      expect(entries.get(key), key).toBe("");
    }
  });
});
