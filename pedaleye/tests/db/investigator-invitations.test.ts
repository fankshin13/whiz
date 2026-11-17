import { afterAll, describe, expect, it } from "vitest";

import { reissueInvitation, revokeInvitation } from "@/lib/invitations/management";
import { acceptInvitation, createInvestigatorInvitation, lookupInvitation } from "@/lib/invitations/operations";

import { ORG, PASSWORD, VEHICLE, adminClient, anonClient, signedInClient } from "./helpers";

// 사고조사관 초대: 슈퍼 관리자는 고른 조직, 조직 관리자는 자기 조직만. 차량 없음. 수락하면 소속 조직 사고 기록만 열람.
const SUPER = { id: "20000000-0000-0000-0000-000000000001", role: "super_admin", orgId: null } as const;
const HWASEONG_ADMIN = { id: "20000000-0000-0000-0000-000000000002", role: "org_admin", orgId: ORG.hwaseong } as const;
const DRIVER_A = { id: "20000000-0000-0000-0000-000000000003", role: "driver", orgId: ORG.hwaseong } as const;
const createdEmails: string[] = [];
const email = (tag: string) => {
  const value = `investigator-${tag}-${Date.now()}@pedaleye.test`;
  createdEmails.push(value);
  return value;
};
const tokenOf = (url: string) => new URL(url).searchParams.get("token") ?? "";

afterAll(async () => {
  const admin = adminClient();
  await admin.from("invitations").delete().in("email", createdEmails);
  const { data } = await admin.from("users").select("id").in("email", createdEmails);
  for (const u of data ?? []) await admin.auth.admin.deleteUser(u.id);
});

describe("사고조사관 초대", () => {
  it("조직 관리자는 요청과 무관하게 자기 조직 조사관을 초대하고, 수락하면 소속 조직 사고 기록만 본다", async () => {
    const hw = await signedInClient("admin.hwaseong@pedaleye.test");
    const address = email("hw");
    const invite = await createInvestigatorInvitation(hw, HWASEONG_ADMIN, { orgId: ORG.seoul, name: "화성 조사관2", email: address, expiresInHours: 12 }, "http://x");
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;

    const token = tokenOf(invite.invitationUrl);
    expect(await lookupInvitation(adminClient(), token)).toMatchObject({ valid: true, role: "investigator", orgName: "화성시 교통안전과", vehiclePlate: null });
    expect(await createInvestigatorInvitation(hw, HWASEONG_ADMIN, { name: "중복", email: address }, "http://x")).toEqual({ ok: false, error: "이미 초대 대기 중인 이메일입니다." });

    expect(await acceptInvitation(adminClient(), { token, password: PASSWORD, passwordConfirm: PASSWORD })).toEqual({ ok: true, email: address, role: "investigator" });
    const { data: profile } = await adminClient().from("users").select("role, org_id").eq("email", address).single();
    expect(profile).toEqual({ role: "investigator", org_id: ORG.hwaseong });

    const client = anonClient();
    await client.auth.signInWithPassword({ email: address, password: PASSWORD });
    const { data: sessions } = await client.from("event_sessions").select("id, device:devices(vehicle:vehicles(org_id))");
    expect(sessions?.length).toBeGreaterThan(0);
    expect(sessions?.every((s) => s.device?.vehicle?.org_id === ORG.hwaseong)).toBe(true);
    const { data: assigned } = await adminClient().from("vehicles").select("id").eq("assigned_user_id", (await client.auth.getUser()).data.user?.id ?? "");
    expect(assigned).toEqual([]); // 차량 배정 없음
  });

  it("슈퍼 관리자는 고른 조직으로 초대하고, 운전자는 초대할 수 없다", async () => {
    const superClient = await signedInClient("super@pedaleye.test");
    const invite = await createInvestigatorInvitation(superClient, SUPER, { orgId: ORG.seoul, name: "서울 조사관", email: email("seoul") }, "http://x");
    expect(invite.ok).toBe(true);
    if (invite.ok) expect(await lookupInvitation(adminClient(), tokenOf(invite.invitationUrl))).toMatchObject({ orgName: "서울법인택시", role: "investigator" });
    expect(await createInvestigatorInvitation(superClient, SUPER, { name: "조직 없음", email: email("noorg") }, "http://x")).toEqual({ ok: false, error: "조직을 선택해 주세요." });

    const driver = await signedInClient("driver.a@pedaleye.test");
    expect(await createInvestigatorInvitation(driver, DRIVER_A, { name: "x", email: email("drv") }, "http://x")).toEqual({ ok: false, error: "소속 조직에만 조사관을 초대할 수 있습니다." });
  });

  it("DB 가 다른 조직 조사관 초대·차량을 붙인 조사관 초대를 막는다", async () => {
    const hw = await signedInClient("admin.hwaseong@pedaleye.test");
    const base = { invitee_name: "직접", role: "investigator" as const, expires_at: new Date(Date.now() + 3_600_000).toISOString(), created_by: HWASEONG_ADMIN.id };
    const cross = await hw.from("invitations").insert({ ...base, org_id: ORG.seoul, email: email("cross"), token_hash: "c".repeat(64) });
    expect(cross.error?.code).toBe("42501");
    const withVehicle = await hw.from("invitations").insert({ ...base, org_id: ORG.hwaseong, vehicle_id: VEHICLE.unassigned, email: email("veh"), token_hash: "d".repeat(64) });
    expect(withVehicle.error).not.toBeNull();
  });

  it("조직 관리자는 자기 조직 조사관 초대를 재발급·취소할 수 있다", async () => {
    const hw = await signedInClient("admin.hwaseong@pedaleye.test");
    const address = email("manage");
    expect((await createInvestigatorInvitation(hw, HWASEONG_ADMIN, { name: "관리 대상", email: address }, "http://x")).ok).toBe(true);
    const { data: row } = await adminClient().from("invitations").select("id").eq("email", address).single();
    const reissued = await reissueInvitation(hw, HWASEONG_ADMIN, { invitationId: row?.id, expiresInHours: 24 }, "http://x");
    expect(reissued.ok).toBe(true);
    const { data: fresh } = await adminClient().from("invitations").select("id").eq("email", address).is("revoked_at", null).single();
    expect(await revokeInvitation(hw, HWASEONG_ADMIN, { invitationId: fresh?.id })).toEqual({ ok: true, changed: true });
  });
});
