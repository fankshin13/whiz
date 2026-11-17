import { afterAll, describe, expect, it } from "vitest";

import { listUsers, setUserActive } from "@/lib/users/operations";

import { ORG, PASSWORD, USER, VEHICLE, adminClient, anonClient, signedInClient } from "./helpers";

// 사용자 관리(결정 2026-11-17: 삭제 없이 비활성화만)
const SUPER = { id: "20000000-0000-0000-0000-000000000001", role: "super_admin", orgId: null } as const;
const HWASEONG_ADMIN = { id: "20000000-0000-0000-0000-000000000002", role: "org_admin", orgId: ORG.hwaseong } as const;
const SEOUL_ADMIN_ID = "20000000-0000-0000-0000-000000000006";
const startedAt = new Date(Date.now() - 1000).toISOString();

afterAll(async () => {
  const admin = adminClient();
  // seed 상태로 복구
  await admin.from("users").update({ is_active: true, deactivated_at: null, deactivated_by: null }).eq("id", USER.driverB);
  await admin.auth.admin.updateUserById(USER.driverB, { ban_duration: "none" });
  await admin.from("vehicles").update({ assigned_user_id: USER.driverB }).eq("id", VEHICLE.driverB);
  await admin.from("users").update({ role: "org_admin" }).eq("id", SEOUL_ADMIN_ID);
});

describe("사용자 목록", () => {
  it("슈퍼 관리자는 전체, 조직 관리자는 자기 조직 운전자·조사관만 본다", async () => {
    const superClient = await signedInClient("super@pedaleye.test");
    for (const role of ["super_admin", "org_admin", "driver", "investigator"] as const) {
      const byRole = await listUsers(superClient, SUPER, { page: 1, role });
      expect(byRole.total, role).toBeGreaterThan(0);
      expect(byRole.users.every((u) => u.role === role)).toBe(true);
    }
    const hwOnly = await listUsers(superClient, SUPER, { page: 1, org: ORG.hwaseong, role: "driver" });
    expect(hwOnly.users.every((u) => u.orgId === ORG.hwaseong)).toBe(true);
    expect(hwOnly.users.find((u) => u.id === USER.driverA)?.lastSignInAt).not.toBeNull(); // 최근 로그인 표시

    const hw = await listUsers(await signedInClient("admin.hwaseong@pedaleye.test"), HWASEONG_ADMIN, { page: 1, org: ORG.seoul, role: "org_admin" });
    expect(hw.users).toEqual([]); // 조직 관리자는 다른 관리자·다른 조직을 볼 수 없다
    const hwAll = await listUsers(await signedInClient("admin.hwaseong@pedaleye.test"), HWASEONG_ADMIN, { page: 1 });
    expect(hwAll.users.every((u) => u.orgId === ORG.hwaseong && (u.role === "driver" || u.role === "investigator"))).toBe(true);

    const byPlate = await listUsers(await signedInClient("admin.hwaseong@pedaleye.test"), HWASEONG_ADMIN, { page: 1, q: "34나" });
    expect(byPlate.users.map((u) => u.id)).toEqual([USER.driverB]);
    expect(byPlate.users[0]?.vehicles.map((v) => v.plateNumber)).toEqual(["34나 7890"]);
  });
});

describe("비활성화·재활성화", () => {
  it("비활성화하면 차량 배정이 풀리고, 열린 세션도 데이터를 못 보며, 로그인이 막힌다. 재활성화하면 다시 로그인된다", async () => {
    const driverSession = await signedInClient("driver.b@pedaleye.test");
    expect((await driverSession.from("vehicles").select("id")).data).toHaveLength(1);

    const hw = await signedInClient("admin.hwaseong@pedaleye.test");
    const result = await setUserActive(hw, HWASEONG_ADMIN, { userId: USER.driverB, active: false, unassignVehicle: true, reason: "퇴사" });
    expect(result).toEqual({ ok: true, changed: true, unassigned: ["34나 7890"] });
    // 같은 요청을 다시 해도 바뀌는 것 없이 성공(멱등)
    expect(await setUserActive(hw, HWASEONG_ADMIN, { userId: USER.driverB, active: false })).toEqual({ ok: true, changed: false, unassigned: [] });

    // 이미 열린 세션: 데이터 0건, 본인 행은 비활성으로 보임
    expect((await driverSession.from("vehicles").select("id")).data).toEqual([]);
    expect((await driverSession.from("event_sessions").select("id")).data).toEqual([]);
    const { data: me } = await driverSession.from("users").select("is_active").eq("id", USER.driverB).single();
    expect(me?.is_active).toBe(false);

    const login = await anonClient().auth.signInWithPassword({ email: "driver.b@pedaleye.test", password: PASSWORD });
    expect(login.error?.code).toBe("user_banned");

    const { data: logs } = await adminClient().from("audit_logs").select("action_type, actor_role, changes_summary").eq("target_id", USER.driverB).gte("created_at", startedAt);
    expect(logs?.find((l) => l.action_type === "USER_DEACTIVATE")).toMatchObject({ actor_role: "org_admin", changes_summary: { reason: "퇴사" } });

    expect(await setUserActive(hw, HWASEONG_ADMIN, { userId: USER.driverB, active: true })).toMatchObject({ ok: true, changed: true });
    const again = await anonClient().auth.signInWithPassword({ email: "driver.b@pedaleye.test", password: PASSWORD });
    expect(again.error).toBeNull();
  });

  it("조직 관리자는 다른 조직 사용자·관리자를 바꿀 수 없고, 계정 상태를 직접 수정할 수도 없다", async () => {
    const hw = await signedInClient("admin.hwaseong@pedaleye.test");
    const notFound = { ok: false, error: "사용자를 찾을 수 없거나 관리 권한이 없습니다." };
    expect(await setUserActive(hw, HWASEONG_ADMIN, { userId: USER.driverC, active: false })).toEqual(notFound);
    expect(await setUserActive(hw, HWASEONG_ADMIN, { userId: SEOUL_ADMIN_ID, active: false })).toEqual(notFound);
    expect(await setUserActive(hw, HWASEONG_ADMIN, { userId: SUPER.id, active: false })).toEqual(notFound);

    const direct = await hw.from("users").update({ is_active: false }).eq("id", USER.driverA);
    expect(direct.error?.code).toBe("42501");

    const driver = await signedInClient("driver.a@pedaleye.test");
    const { error } = await driver.rpc("set_user_active", { p_user_id: USER.driverB, p_active: false });
    expect(error?.code).toBe("42501");
  });

  it("본인 계정은 비활성화할 수 없다(서버·DB 모두)", async () => {
    const superClient = await signedInClient("super@pedaleye.test");
    expect(await setUserActive(superClient, SUPER, { userId: SUPER.id, active: false })).toEqual({ ok: false, error: "본인 계정은 비활성화할 수 없습니다." });
    const { error } = await superClient.rpc("set_user_active", { p_user_id: SUPER.id, p_active: false });
    expect(error?.message).toBe("SELF");
  });

  it("슈퍼 관리자는 조직 관리자를 운전자로 강등할 수 있고, 조직 관리자는 강등을 쓸 수 없다", async () => {
    const hw = await signedInClient("admin.hwaseong@pedaleye.test");
    expect((await setUserActive(hw, HWASEONG_ADMIN, { userId: USER.driverA, active: false, demote: true })).ok).toBe(false);

    const superClient = await signedInClient("super@pedaleye.test");
    expect(await setUserActive(superClient, SUPER, { userId: SEOUL_ADMIN_ID, active: false, demote: true, reason: "담당 변경" })).toMatchObject({ ok: true });
    const { data } = await adminClient().from("users").select("role, is_active").eq("id", SEOUL_ADMIN_ID).single();
    expect(data).toEqual({ role: "driver", is_active: true });
    const { data: logs } = await adminClient().from("audit_logs").select("action_type").eq("target_id", SEOUL_ADMIN_ID).gte("created_at", startedAt);
    expect(logs?.map((l) => l.action_type)).toContain("USER_ROLE_CHANGE");
  });
});
