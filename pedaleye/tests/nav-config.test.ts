import { describe, expect, it } from "vitest";

import { NAV_ITEMS, isActivePath, navItemsForRole } from "@/components/navigation/nav-config";
import { allowedRolesForPath } from "@/lib/auth/roles";

describe("네비게이션 설정", () => {
  it("메뉴 5개가 모두 보호 라우트 맵에 등록돼 있다", () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      "/dashboard",
      "/vehicles",
      "/events",
      "/devices/calibrate",
      "/admin/organizations",
    ]);
    for (const item of NAV_ITEMS) expect(allowedRolesForPath(item.href)).not.toBeNull();
  });

  it("역할별로 접근 가능한 메뉴만 보인다", () => {
    const titles = (role: Parameters<typeof navItemsForRole>[0]) => navItemsForRole(role).map((i) => i.href);
    expect(titles("super_admin")).toEqual(["/dashboard", "/vehicles", "/events", "/admin/organizations"]);
    expect(titles("org_admin")).toEqual(["/dashboard", "/vehicles", "/events", "/devices/calibrate"]);
    expect(titles("driver")).toEqual(["/dashboard", "/devices/calibrate"]);
    expect(titles("investigator")).toEqual(["/events"]);
  });

  it("하위 경로에서도 메뉴가 활성화되고, 이름만 비슷한 경로는 제외된다", () => {
    expect(isActivePath("/events/abc", "/events")).toBe(true);
    expect(isActivePath("/events", "/events")).toBe(true);
    expect(isActivePath("/eventsx", "/events")).toBe(false);
  });
});
