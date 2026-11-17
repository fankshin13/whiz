import { describe, expect, it } from "vitest";

import { allowedRolesForPath, homePathForRole, postLoginPath, safeInternalPath } from "@/lib/auth/roles";

describe("라우트 권한 맵", () => {
  it("마스터 스펙 라우트 맵대로 역할을 허용한다", () => {
    expect(allowedRolesForPath("/dashboard")).toEqual(["super_admin", "org_admin", "driver"]);
    expect(allowedRolesForPath("/vehicles")).toEqual(["super_admin", "org_admin"]);
    expect(allowedRolesForPath("/vehicles/abc")).toEqual(["super_admin", "org_admin", "driver"]);
    expect(allowedRolesForPath("/events/abc/report")).toEqual(["super_admin", "org_admin", "investigator", "driver"]);
    expect(allowedRolesForPath("/devices/calibrate")).toEqual(["super_admin", "org_admin", "driver"]);
    expect(allowedRolesForPath("/devices")).toEqual(["super_admin", "org_admin"]);
    expect(allowedRolesForPath("/devices/")).toEqual(["super_admin", "org_admin"]);
    expect(allowedRolesForPath("/admin/audit")).toEqual(["super_admin", "org_admin"]);
    expect(allowedRolesForPath("/admin/audit/export")).toEqual(["super_admin", "org_admin"]);
    expect(allowedRolesForPath("/admin/organizations")).toEqual(["super_admin"]);
    expect(allowedRolesForPath("/users")).toEqual(["super_admin", "org_admin"]);
    expect(allowedRolesForPath("/admin/organizations")).toEqual(["super_admin"]);
    expect(allowedRolesForPath("/users")).toEqual(["super_admin", "org_admin"]);
  });

  it("공개 경로와 비슷한 이름의 경로는 보호 대상이 아니다", () => {
    expect(allowedRolesForPath("/auth/login")).toBeNull();
    expect(allowedRolesForPath("/")).toBeNull();
    expect(allowedRolesForPath("/dashboards")).toBeNull();
  });
});

describe("로그인 후 이동 경로", () => {
  it("역할별 홈으로 보낸다", () => {
    expect(homePathForRole("driver")).toBe("/dashboard");
    expect(homePathForRole("investigator")).toBe("/events");
  });

  it("권한 있는 요청 경로는 유지하고, 권한 없는 경로는 홈으로 바꾼다", () => {
    expect(postLoginPath("org_admin", "/vehicles?page=2")).toBe("/vehicles?page=2");
    expect(postLoginPath("driver", "/admin/organizations")).toBe("/dashboard");
    expect(postLoginPath("investigator", "/dashboard")).toBe("/events");
  });

  it("외부 사이트로의 리다이렉트를 막는다", () => {
    for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "", null, undefined]) {
      expect(safeInternalPath(value)).toBeNull();
    }
    expect(postLoginPath("super_admin", "//evil.example/admin")).toBe("/dashboard");
  });
});
