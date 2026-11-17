import type { Database } from "@/lib/supabase/database.types";

export type UserRole = Database["public"]["Enums"]["user_role"];

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "슈퍼 관리자",
  org_admin: "조직 관리자",
  driver: "운전자",
  investigator: "사고 조사관",
};

// 마스터 스펙 '표준 페이지 라우트 맵'의 접근 권한. 위에서부터 먼저 맞는 규칙을 적용한다.
const ROUTE_ACCESS: ReadonlyArray<{ pattern: RegExp; roles: readonly UserRole[] }> = [
  { pattern: /^\/dashboard(\/|$)/, roles: ["super_admin", "org_admin", "driver"] },
  { pattern: /^\/vehicles\/?$/, roles: ["super_admin", "org_admin"] },
  { pattern: /^\/vehicles\/[^/]+\/?$/, roles: ["super_admin", "org_admin", "driver"] },
  // 운전자는 본인 배정 차량 세션만(RLS 와 loadSessionForensics 가 범위를 제한)
  { pattern: /^\/events(\/|$)/, roles: ["super_admin", "org_admin", "investigator", "driver"] },
  { pattern: /^\/devices\/calibrate(\/|$)/, roles: ["super_admin", "org_admin", "driver"] },
  { pattern: /^\/devices\/?$/, roles: ["super_admin", "org_admin"] },
  { pattern: /^\/admin(\/|$)/, roles: ["super_admin"] },
];

/** 보호 라우트면 허용 역할 목록, 공개 라우트면 null. */
export function allowedRolesForPath(pathname: string): readonly UserRole[] | null {
  return ROUTE_ACCESS.find((rule) => rule.pattern.test(pathname))?.roles ?? null;
}

export function homePathForRole(role: UserRole): string {
  return role === "investigator" ? "/events" : "/dashboard";
}

/** 같은 사이트 내부 경로만 허용해 오픈 리다이렉트를 막는다. */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  return value;
}

/** 로그인 후 이동할 경로: 요청한 경로가 안전하고 권한이 있으면 그곳, 아니면 역할별 홈. */
export function postLoginPath(role: UserRole, requested: string | null | undefined): string {
  const path = safeInternalPath(requested);
  if (path) {
    const roles = allowedRolesForPath(path.split("?")[0] ?? path);
    if (roles?.includes(role)) return path;
  }
  return homePathForRole(role);
}
