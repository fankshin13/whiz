import { afterAll, describe, expect, it } from "vitest";

import { acceptInvitation, createInvitation, lookupInvitation } from "@/lib/invitations/operations";
import { hashInvitationToken } from "@/lib/invitations/token";

import { ORG, PASSWORD, VEHICLE, adminClient, anonClient, signedInClient } from "./helpers";

const BASE = "http://127.0.0.1:3000";
const HWASEONG_ADMIN = { id: "20000000-0000-0000-0000-000000000002", role: "org_admin", orgId: ORG.hwaseong } as const;
const SEOUL_ADMIN = { id: "20000000-0000-0000-0000-000000000006", role: "org_admin", orgId: ORG.seoul } as const;

const tokenFrom = (url: string) => new URL(url).searchParams.get("token") ?? "";
const createdEmails: string[] = [];

function uniqueEmail(tag: string) {
  const email = `invite-${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}@pedaleye.test`;
  createdEmails.push(email);
  return email;
}

async function newInvitation(tag: string, vehicleId: string = VEHICLE.unassigned) {
  const supabase = await signedInClient("admin.hwaseong@pedaleye.test");
  const email = uniqueEmail(tag);
  const result = await createInvitation(supabase, HWASEONG_ADMIN, { vehicleId, name: `운전자 ${tag}`, email }, BASE);
  if (!result.ok) throw new Error(result.error);
  return { ...result, email, token: tokenFrom(result.invitationUrl) };
}

// 테스트가 만든 초대·계정·차량 배정을 원래대로 돌린다
async function resetUnassignedVehicle() {
  const admin = adminClient();
  await admin.from("vehicles").update({ assigned_user_id: null }).eq("id", VEHICLE.unassigned);
  await admin.from("invitations").delete().eq("vehicle_id", VEHICLE.unassigned);
}

afterAll(async () => {
  const admin = adminClient();
  await resetUnassignedVehicle();
  const { data } = await admin.from("users").select("id, email").in("email", createdEmails);
  for (const user of data ?? []) await admin.auth.admin.deleteUser(user.id);
});

describe("초대 생성", () => {
  it("org_admin 이 미배정 차량에 24시간 1회용 링크를 만들고, DB 에는 해시만 저장된다", async () => {
    await resetUnassignedVehicle();
    const before = Date.now();
    const invite = await newInvitation("create");

    expect(invite.invitationUrl.startsWith(`${BASE}/auth/invite?token=`)).toBe(true);
    expect(invite.token).toMatch(/^[0-9a-f]{64}$/);

    const { data } = await adminClient()
      .from("invitations")
      .select("token_hash, expires_at, org_id, used_at")
      .eq("email", invite.email)
      .single();
    expect(data?.token_hash).toBe(hashInvitationToken(invite.token));
    expect(data?.token_hash).not.toContain(invite.token);
    expect(data?.org_id).toBe(ORG.hwaseong);
    expect(data?.used_at).toBeNull();
    const hours = (new Date(data?.expires_at ?? 0).getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);

    // 같은 차량 중복 초대 차단
    const supabase = await signedInClient("admin.hwaseong@pedaleye.test");
    const dup = await createInvitation(supabase, HWASEONG_ADMIN, { vehicleId: VEHICLE.unassigned, name: "중복", email: uniqueEmail("dup") }, BASE);
    expect(dup.ok).toBe(false);
  });

  it("driver·타 조직 관리자·배정된 차량은 초대할 수 없다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const byDriver = await createInvitation(driver, { id: "20000000-0000-0000-0000-000000000003", role: "driver", orgId: ORG.hwaseong }, { vehicleId: VEHICLE.unassigned, name: "x", email: uniqueEmail("drv") }, BASE);
    expect(byDriver).toEqual({ ok: false, error: "운전자를 초대할 권한이 없습니다." });

    const directInsert = await driver.from("invitations").insert({
      org_id: ORG.hwaseong, email: "x@pedaleye.test", invitee_name: "x", token_hash: "f".repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(), created_by: "20000000-0000-0000-0000-000000000003",
    });
    expect(directInsert.error?.code).toBe("42501");

    const seoul = await signedInClient("admin.seoul@pedaleye.test");
    const crossOrg = await createInvitation(seoul, SEOUL_ADMIN, { vehicleId: VEHICLE.unassigned, name: "x", email: uniqueEmail("cross") }, BASE);
    expect(crossOrg).toEqual({ ok: false, error: "차량 배정 권한이 없습니다." });

    const hwaseong = await signedInClient("admin.hwaseong@pedaleye.test");
    const assigned = await createInvitation(hwaseong, HWASEONG_ADMIN, { vehicleId: VEHICLE.driverA, name: "x", email: uniqueEmail("assigned") }, BASE);
    expect(assigned).toEqual({ ok: false, error: "이미 운전자가 배정된 차량입니다." });
  });

  it("타 조직 관리자는 초대 내역을 볼 수 없다", async () => {
    const seoul = await signedInClient("admin.seoul@pedaleye.test");
    const { data } = await seoul.from("invitations").select("id").eq("org_id", ORG.hwaseong);
    expect(data).toEqual([]);
  });
});

describe("초대 조회·수락", () => {
  it("유효한 링크는 조직명·차량 번호를 보여 주고, 수락하면 계정·세션·차량 배정이 완료되며 재사용은 막힌다", async () => {
    await resetUnassignedVehicle();
    const invite = await newInvitation("accept");
    const admin = adminClient();

    expect(await lookupInvitation(admin, invite.token)).toEqual({
      valid: true,
      email: invite.email,
      inviteeName: "운전자 accept",
      orgName: "화성시 교통안전과",
      vehiclePlate: "56다 1004",
      role: "driver",
    });

    const accepted = await acceptInvitation(admin, { token: invite.token, password: PASSWORD, passwordConfirm: PASSWORD });
    expect(accepted).toEqual({ ok: true, email: invite.email, role: "driver" });

    const { data: inv } = await admin.from("invitations").select("used_at, accepted_user_id").eq("email", invite.email).single();
    expect(inv?.used_at).not.toBeNull();
    const { data: vehicle } = await admin.from("vehicles").select("assigned_user_id").eq("id", VEHICLE.unassigned).single();
    expect(vehicle?.assigned_user_id).toBe(inv?.accepted_user_id);
    const { data: profile } = await admin.from("users").select("org_id, role, name").eq("email", invite.email).single();
    expect(profile).toEqual({ org_id: ORG.hwaseong, role: "driver", name: "운전자 accept" });

    // 설정한 비밀번호로 로그인 → 본인 배정 차량만 보인다
    const driver = await signedInClient(invite.email);
    const { data: visible } = await driver.from("vehicles").select("id");
    expect(visible).toEqual([{ id: VEHICLE.unassigned }]);

    // 재사용 차단: 조회·수락 모두 ALREADY_USED, 계정 추가 생성 없음
    expect(await lookupInvitation(admin, invite.token)).toEqual({ valid: false, reason: "ALREADY_USED" });
    const replay = await acceptInvitation(admin, { token: invite.token, password: "Another-Pass-123", passwordConfirm: "Another-Pass-123" });
    expect(replay).toEqual({ ok: false, reason: "ALREADY_USED" });
    const { count } = await admin.from("users").select("id", { count: "exact", head: true }).eq("email", invite.email);
    expect(count).toBe(1);
  });

  it("만료된 링크는 EXPIRED 로 거부되고 계정이 생기지 않는다", async () => {
    await resetUnassignedVehicle();
    const invite = await newInvitation("expired");
    const admin = adminClient();
    await admin.from("invitations").update({ created_at: new Date(Date.now() - 7_200_000).toISOString(), expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("email", invite.email);

    expect(await lookupInvitation(admin, invite.token)).toEqual({ valid: false, reason: "EXPIRED" });
    expect(await acceptInvitation(admin, { token: invite.token, password: PASSWORD, passwordConfirm: PASSWORD })).toEqual({ ok: false, reason: "EXPIRED" });
    const { count } = await admin.from("users").select("id", { count: "exact", head: true }).eq("email", invite.email);
    expect(count).toBe(0);
  });

  it("변조·형식 오류 토큰은 NOT_FOUND 로만 응답한다", async () => {
    const admin = adminClient();
    expect(await lookupInvitation(admin, "a".repeat(64))).toEqual({ valid: false, reason: "NOT_FOUND" });
    expect(await lookupInvitation(admin, "' or 1=1 --")).toEqual({ valid: false, reason: "NOT_FOUND" });
    expect(await lookupInvitation(admin, "")).toEqual({ valid: false, reason: "NOT_FOUND" });
  });

  it("비밀번호 확인 불일치·짧은 비밀번호는 거부된다", async () => {
    const admin = adminClient();
    const mismatch = await acceptInvitation(admin, { token: "a".repeat(64), password: "Password-123", passwordConfirm: "Password-124" });
    expect(mismatch).toEqual({ ok: false, reason: "INVALID_INPUT", error: "비밀번호 확인이 일치하지 않습니다." });
    const short = await acceptInvitation(admin, { token: "a".repeat(64), password: "short", passwordConfirm: "short" });
    expect(short).toMatchObject({ ok: false, reason: "INVALID_INPUT" });
  });

  it("수락 함수는 로그인 사용자·익명이 직접 호출할 수 없다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const asDriver = await driver.rpc("accept_invitation", { p_token_hash: "a".repeat(64), p_user_id: "20000000-0000-0000-0000-000000000003" });
    expect(asDriver.error?.code).toBe("42501");
    const asAnon = await anonClient().rpc("accept_invitation", { p_token_hash: "a".repeat(64), p_user_id: "20000000-0000-0000-0000-000000000003" });
    expect(asAnon.error?.code).toBe("42501");
  });
});
