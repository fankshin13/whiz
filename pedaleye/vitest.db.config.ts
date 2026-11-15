import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 로컬 Supabase(supabase start) 대상 통합 테스트. 원격/운영 DB에 실행하지 않는다.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // server-only 는 Next 서버 번들 밖에서 import 하면 예외를 던지므로 테스트에서는 빈 모듈로 대체
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    fileParallelism: false,
  },
});
