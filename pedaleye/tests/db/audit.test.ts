import { afterAll, describe, expect, it } from "vitest";

import { auditIfDenied, listAuditLogs, logAuditEvent } from "@/lib/audit/operations";
import { mountDevice } from "@/lib/devices/operations";
import { createInvitation } from "@/lib/invitations/operations";
import { acceptInvitation } from "@/lib/invitations/operations";
import { upsertVehicle } from "@/lib/vehicles/operations";

import { DEVICE, ORG, PASSWORD, USER, VEHICLE, adminClient, signedInClient } from "./helpers";

// 감사 로그: 변경은 트리거가 자동 기록, 보고서 열람·거부는 서버가 기록. 추가만 되고 수정·삭제 불가.
const HWASEONG_ADMIN = { id: "20000000-0000-0000-0000-000000000002", role: "org_admin", orgId: ORG.hwaseong } as const;
const SEOUL_ADMIN = { role: "org_admin", orgId: ORG.seoul } as const;
const SUPER = { role: "super_admin", orgId: null } as const;
const SESSION_A = "50000000-0000-0000-0000-000000000001";
const startedAt = new Date(Date.now() - 1000).toISOString();
const createdEmails: string[] = [];

async function logsFor(targetId: string) {
  const { data, error } = await adminClient()
    .from("audit_logs")
    .select("*")
    .eq("target_id", targetId)
    .gte("created_at", startedAt)
    .order("created_at");
  if (error) throw error;
  return data;
}

afterAll(async () => {
  const admin = adminClient();
  await admin.from("vehicles").update({ model_name: "아반떼", assigned_user_id: USER.driverA }).eq("id", VEHICLE.driverA);
  await admin.from("devices").update({ vehicle_id: null }).eq("id", DEVICE.inventory);
  await admin.from("devices").update({ vehicle_id: VEHICLE.driverA }).eq("id", DEVICE.driverA);
  await admin.from("vehicles").update({ assigned_user_id: null }).eq("id", VEHICLE.unassigned);
  await admin.from("invitations").delete().eq("vehicle_id", VEHICLE.unassigned);
  const { data } = await admin.from("users").select("id").in("email", createdEmails);
  for (const user of data ?? []) await admin.auth.admin.deleteUser(user.id);
});

describe("변경 자동 기록", () => {
  it("조직 관리자의 차량 수정은 수행자·조직·변경 전후·요청 IP 와 함께 남는다", async () => {
    const client = await signedInClient("admin.hwaseong@pedaleye.test", { "x-pedaleye-client-ip": "203.0.113.9" });
    const result = await upsertVehicle(client, HWASEONG_ADMIN, { id: VEHICLE.driverA, plate_number: "12가 3456", model_name: "아반떼 N" });
    expect(result.ok).toBe(true);

    const [log] = await logsFor(VEHICLE.driverA);
    expect(log).toMatchObject({
      action_type: "VEHICLE_UPDATE",
      actor_id: HWASEONG_ADMIN.id,
      actor_name: "화성시 관리자",
      actor_role: "org_admin",
      org_id: ORG.hwaseong,
      target_type: "vehicle",
      target_display_name: "12가 3456",
      status: "SUCCESS",
      ip_address: "203.0.113.9",
      changes_summary: { before: { model_name: "아반떼" }, after: { model_name: "아반떼 N" } },
    });
  });

  it("초대 기록에는 토큰 해시와 이메일 원문이 남지 않고, 수락은 수락한 사용자로 남는다", async () => {
    const admin = adminClient();
    await admin.from("vehicles").update({ assigned_user_id: null }).eq("id", VEHICLE.unassigned);
    const email = `audit-${Date.now()}@pedaleye.test`;
    createdEmails.push(email);
    const client = await signedInClient("admin.hwaseong@pedaleye.test");
    const invite = await createInvitation(client, HWASEONG_ADMIN, { vehicleId: VEHICLE.unassigned, name: "감사 대상", email }, "http://x");
    if (!invite.ok) throw new Error(invite.error);
    const token = new URL(invite.invitationUrl).searchParams.get("token") ?? "";

    const { data: row } = await admin.from("invitations").select("id, token_hash").eq("email", email).single();
    const [created] = await logsFor(row?.id ?? "");
    const text = JSON.stringify(created);
    expect(created?.action_type).toBe("INVITATION_CREATE");
    expect(text).not.toContain(row?.token_hash ?? "x");
    expect(text).not.toContain(token);
    expect(text).not.toContain(email);
    expect(text).toContain("***REDACTED***");

    const accepted = await acceptInvitation(admin, { token, password: PASSWORD, passwordConfirm: PASSWORD });
    expect(accepted.ok).toBe(true);
    const logs = await logsFor(row?.id ?? "");
    const accept = logs.find((l) => l.action_type === "INVITATION_ACCEPT");
    expect(accept?.actor_name).toBe("감사 대상");
    expect(accept?.actor_role).toBe("driver");
  });

  it("단말 교체는 해제·장착 두 건 모두 DEVICE_REPLACE 로 남는다", async () => {
    const client = await signedInClient("admin.hwaseong@pedaleye.test");
    expect((await mountDevice(client, HWASEONG_ADMIN, { deviceId: DEVICE.inventory, vehicleId: VEHICLE.driverA, replace: true })).ok).toBe(true);
    expect((await logsFor(DEVICE.driverA)).map((l) => l.action_type)).toContain("DEVICE_REPLACE");
    expect((await logsFor(DEVICE.inventory)).map((l) => l.action_type)).toContain("DEVICE_REPLACE");
  });
});

describe("불변·조회 범위", () => {
  it("누구도 감사 기록을 넣거나 고치거나 지울 수 없다(서비스 키 포함)", async () => {
    const superClient = await signedInClient("super@pedaleye.test");
    const insert = await superClient.from("audit_logs").insert({ actor_name: "x", action_type: "ORG_CREATE", target_type: "x", target_id: "x", target_display_name: "x" });
    expect(insert.error).not.toBeNull();
    const update = await superClient.from("audit_logs").update({ actor_name: "HACKED" }).gte("created_at", startedAt).select("id");
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);

    const admin = adminClient();
    const [any] = await logsFor(VEHICLE.driverA);
    const svcUpdate = await admin.from("audit_logs").update({ actor_name: "HACKED" }).eq("id", any?.id ?? "");
    expect(svcUpdate.error?.message).toContain("수정하거나 삭제할 수 없습니다");
    const svcDelete = await admin.from("audit_logs").delete().eq("id", any?.id ?? "");
    expect(svcDelete.error?.message).toContain("수정하거나 삭제할 수 없습니다");
  });

  it("조직 관리자는 자기 조직 기록만, 운전자·조사관은 0건, 슈퍼 관리자는 전체", async () => {
    const hw = await listAuditLogs(await signedInClient("admin.hwaseong@pedaleye.test"), HWASEONG_ADMIN, { page: 1, org: ORG.seoul });
    expect(hw.rows.length).toBeGreaterThan(0);
    expect(hw.rows.every((r) => r.org_id === ORG.hwaseong)).toBe(true);

    const seoul = await listAuditLogs(await signedInClient("admin.seoul@pedaleye.test"), SEOUL_ADMIN, { page: 1 });
    expect(seoul.rows.every((r) => r.org_id === ORG.seoul)).toBe(true);

    for (const email of ["driver.a@pedaleye.test", "investigator.hwaseong@pedaleye.test"]) {
      const { data } = await (await signedInClient(email)).from("audit_logs").select("id");
      expect(data, email).toEqual([]);
    }
    await expect(listAuditLogs(await signedInClient("driver.a@pedaleye.test"), { role: "driver", orgId: ORG.hwaseong }, { page: 1 })).rejects.toThrow("FORBIDDEN");

    const all = await listAuditLogs(await signedInClient("super@pedaleye.test"), SUPER, { page: 1, q: "화성시 관리자" });
    expect(all.total).toBeGreaterThan(0);
  });
});

describe("서버 기록(보고서·거부)", () => {
  it("보고서 열람은 세션 소속 조직으로, 권한 거부는 DENIED 로 남는다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    await logAuditEvent(driver, { action: "REPORT_VIEW", targetType: "event_report", targetId: SESSION_A });
    const [view] = await logsFor(SESSION_A);
    expect(view).toMatchObject({ action_type: "REPORT_VIEW", actor_role: "driver", org_id: ORG.hwaseong, status: "SUCCESS" });

    const hw = await signedInClient("admin.hwaseong@pedaleye.test");
    const cross = await upsertVehicle(hw, HWASEONG_ADMIN, { id: VEHICLE.driverC, plate_number: "서울32바 1234", model_name: "탈취" });
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    await auditIfDenied(hw, cross.error, { action: "VEHICLE_UPDATE", targetType: "vehicle", targetId: VEHICLE.driverC });
    const [denied] = await logsFor(VEHICLE.driverC);
    expect(denied).toMatchObject({ action_type: "VEHICLE_UPDATE", status: "DENIED", actor_role: "org_admin", org_id: ORG.hwaseong });
  });

  it("서버 기록 함수로 변경 작업의 '성공' 기록을 위조할 수 없고, 수행자를 바꿀 수 없다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const { error } = await driver.rpc("log_admin_audit_event", { p_action_type: "ORG_CREATE", p_target_type: "organization", p_target_id: "fake", p_status: "SUCCESS" });
    expect(error?.code).toBe("22023");
    const anon = await adminClient().rpc("log_admin_audit_event", { p_action_type: "REPORT_VIEW", p_target_type: "event_report", p_target_id: SESSION_A });
    expect(anon.error?.code).toBe("42501"); // 로그인 세션 없음
  });
});
