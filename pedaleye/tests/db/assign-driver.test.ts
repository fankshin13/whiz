import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createInvitation } from "@/lib/invitations/operations";
import { assignDriver, listAssignableDrivers } from "@/lib/vehicles/operations";

import { ORG, USER, VEHICLE, adminClient, signedInClient } from "./helpers";

// 가입된 운전자 직접 배정(결정 2026-11-17): 같은 조직의 미배정 활성 운전자만, 사유는 감사 로그
const HWASEONG_ADMIN = { id: "20000000-0000-0000-0000-000000000002", role: "org_admin", orgId: ORG.hwaseong } as const;
const SEOUL_ADMIN = { id: "20000000-0000-0000-0000-000000000006", role: "org_admin", orgId: ORG.seoul } as const;
const INVESTIGATOR_ID = "20000000-0000-0000-0000-000000000005";
const startedAt = new Date(Date.now() - 1000).toISOString();

async function reset() {
  const admin = adminClient();
  await admin.from("invitations").delete().eq("vehicle_id", VEHICLE.unassigned);
  await admin.from("vehicles").update({ assigned_user_id: null }).eq("id", VEHICLE.unassigned);
  await admin.from("vehicles").update({ assigned_user_id: null }).eq("id", VEHICLE.driverB); // 운전자 B 를 미배정으로
  await admin.from("users").update({ is_active: true }).eq("id", USER.driverB);
}

beforeEach(reset);
afterAll(async () => {
  await reset();
  await adminClient().from("vehicles").update({ assigned_user_id: USER.driverB }).eq("id", VEHICLE.driverB);
});

describe("기존 운전자 배정", () => {
  it("조직 관리자는 미배정 운전자를 배정하고, 사유가 감사 로그에 남으며, 운전자에게 차량이 보인다", async () => {
    const hw = await signedInClient("admin.hwaseong@pedaleye.test");
    const assignable = await listAssignableDrivers(hw, ORG.hwaseong);
    expect(assignable.map((d) => d.id)).toContain(USER.driverB);
    expect(assignable.map((d) => d.id)).not.toContain(USER.driverA); // 이미 배정됨

    expect(await assignDriver(hw, HWASEONG_ADMIN, { vehicleId: VEHICLE.unassigned, userId: USER.driverB, reason: "담당 차량 변경" })).toEqual({ ok: true, data: null });
    const { data: logs } = await adminClient()
      .from("audit_logs")
      .select("action_type, actor_role, changes_summary")
      .eq("target_id", VEHICLE.unassigned)
      .eq("action_type", "VEHICLE_DRIVER_ASSIGN")
      .gte("created_at", startedAt);
    expect(logs?.[0]).toMatchObject({ actor_role: "org_admin", changes_summary: { reason: "담당 차량 변경", after: { assigned_user_id: USER.driverB } } });

    const driver = await signedInClient("driver.b@pedaleye.test");
    const { data } = await driver.from("vehicles").select("id");
    expect(data?.map((v) => v.id)).toEqual([VEHICLE.unassigned]);
  });

  it("배정된 차량·다른 차량의 운전자·다른 조직·조사관·비활성 계정은 배정할 수 없다", async () => {
    const hw = await signedInClient("admin.hwaseong@pedaleye.test");
    const assign = (vehicleId: string, userId: string) => assignDriver(hw, HWASEONG_ADMIN, { vehicleId, userId });
    expect(await assign(VEHICLE.driverA, USER.driverB)).toEqual({ ok: false, error: "이미 운전자가 배정된 차량입니다. 먼저 배정을 해제해 주세요." });
    expect(await assign(VEHICLE.unassigned, USER.driverA)).toEqual({ ok: false, error: "이 운전자는 이미 다른 차량에 배정되어 있습니다. 그 차량의 배정을 먼저 해제해 주세요." });
    const notEligible = { ok: false, error: "배정할 수 없는 사용자입니다. 같은 조직의 활성 운전자만 배정할 수 있습니다." };
    expect(await assign(VEHICLE.unassigned, USER.driverC)).toEqual(notEligible);
    expect(await assign(VEHICLE.unassigned, INVESTIGATOR_ID)).toEqual(notEligible);
    await adminClient().from("users").update({ is_active: false }).eq("id", USER.driverB);
    expect(await assign(VEHICLE.unassigned, USER.driverB)).toEqual(notEligible);

    const seoul = await signedInClient("admin.seoul@pedaleye.test");
    expect(await assignDriver(seoul, SEOUL_ADMIN, { vehicleId: VEHICLE.unassigned, userId: USER.driverC })).toEqual({ ok: false, error: "차량을 찾을 수 없거나 관리 권한이 없습니다." });
    const driver = await signedInClient("driver.a@pedaleye.test");
    expect((await driver.rpc("assign_driver", { p_vehicle_id: VEHICLE.unassigned, p_user_id: USER.driverB })).error?.code).toBe("42501");
  });

  it("차량에 대기 중인 초대가 있으면 먼저 취소하라고 안내한다", async () => {
    const hw = await signedInClient("admin.hwaseong@pedaleye.test");
    const invite = await createInvitation(hw, HWASEONG_ADMIN, { vehicleId: VEHICLE.unassigned, name: "대기", email: `assign-${Date.now()}@pedaleye.test` }, "http://x");
    expect(invite.ok).toBe(true);
    expect(await assignDriver(hw, HWASEONG_ADMIN, { vehicleId: VEHICLE.unassigned, userId: USER.driverB })).toEqual({ ok: false, error: "이 차량에 대기 중인 초대가 있습니다. 초대를 먼저 취소해 주세요." });
  });
});
