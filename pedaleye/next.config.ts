import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 권한 없는 접근에 forbidden()으로 HTTP 403을 돌려주기 위해 사용
  experimental: { authInterrupts: true },
};

export default nextConfig;
