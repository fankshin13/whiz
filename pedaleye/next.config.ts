import type { NextConfig } from "next";

import { validateServerEnv } from "./lib/server/env-schema";

// Vercel 빌드에서는 필수 환경 변수를 먼저 검사해, 설정이 틀린 배포가 운영에 올라가지 않게 한다.
if (process.env.VERCEL === "1") validateServerEnv();

const nextConfig: NextConfig = {
  // 권한 없는 접근에 forbidden()으로 HTTP 403을 돌려주기 위해 사용
  experimental: { authInterrupts: true },
};

export default nextConfig;
