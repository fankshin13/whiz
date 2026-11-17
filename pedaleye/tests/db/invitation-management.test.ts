import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST as acceptPost } from "@/app/api/invitations/accept/route";
import { POST as verifyPost } from "@/app/api/invitations/verify/route";
import { listInvitations, reissueInvitation, revokeInvitation } from "@/lib/invitations/management";
import { acceptInvitation, createInvitation, createOrgAdminInvitation, lookupInvitation } from "@/lib/invitations/operations";

import { ORG, PASSWORD, VEHICLE, adminClient, signedInClient } from "./helpers";

// 초대 관리: 대기 초대 취소·재발급(기존 취소 + 새 초대), 취소된 링크는 웹·앱 모두 수락 불가
const HWASEONG_ADMIN = { id: "20000000-0000-0000-0000-000000000002", role: "org_admin", orgId: ORG.hwaseong } as const;
const SEOUL_ADMIN = { id: "20000000-0000-0000-0000-000000000006", role: "org_admin", orgId: ORG.seoul } as const;
const SUPER = { id: "20000000-0000-0000-0000-000000000001", role: "super_admin", orgId: null } as const;
const createdEmails: string[] = [];
let ipSeq = 0;

const tokenOf = (url: string) => new URL(url).searchParams.get("token") ?? "";
function post(handler: (r: Request) => Promise<Response>, body: unknown) {
  return handler(
    new Request("http://127.0.0.1:3000/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${200 + (ipSeq += 1)}` },
      body: JSON.stringify(body),
    }),
  );
}

async function reset() {
  const admin = adminClient();
  await admin.from("vehicles").update({ assigned_user_id: null }).eq("id", VEHICLE.unassigned);
  await admin.from("invitations").delete().eq("vehicle_id", VEHICLE.unassigned);
}

async function newDriverInvite(tag: string) {
  const email = `inv-${tag}-${Date.now()}@pedaleye.test`;
  createdEmails.push(email);
  const client = await signedInClient("admin.hwaseong@pedaleye.test");
  const created = await createInvitation(client, HWASEONG_ADMIN, { vehicleId: VEHICLE.unassigned, name: `초대 ${tag}`, email }, "http://x");
  if (!created.ok) throw new Error(created.error);
  const { data } = await adminClient().from("invitations").select("id").eq("email", email).single();
  return { client, email, token: tokenOf(created.invitationUrl), id: data?.id ?? "" };
}

beforeEach(reset);
afterAll(async () => {
  await reset();
  const admin = adminClient();
  await admin.from("invitations").delete().in("email", createdEmails);
  const { data } = await admin.from("users").select("id").in("email", createdEmails);
  for (const u of data ?? []) await admin.auth.admin.deleteUser(u.id);
});

describe("초대 취소", () => {
  it("취소한 링크는 확인·수락(웹·앱 API) 모두 REVOKED 로 거부되고 감사 기록이 남는다", async () => {
    const inv = await newDriverInvite("revoke");
    expect(await revokeInvitation(inv.client, HWASEONG_ADMIN, { invitationId: inv.id, reason: "이메일 오기" })).toEqual({ ok: true, changed: true });
    expect(await revokeInvitation(inv.client, HWASEONG_ADMIN, { invitationId: inv.id })).toEqual({ ok: true, changed: false }); // 멱등

    expect(await lookupInvitation(adminClient(), inv.token)).toEqual({ valid: false, reason: "REVOKED" });
    expect(await (await post(verifyPost, { token: inv.token })).json()).toEqual({ isValid: false, reason: "REVOKED", message: "관리자에 의해 취소된 초대 링크입니다." });
    const accept = await post(acceptPost, { token: inv.token, password: PASSWORD });
    expect(await accept.json()).toMatchObject({ success: false, error: "REVOKED" });
    expect(await acceptInvitation(adminClient(), { token: inv.token, password: PASSWORD, passwordConfirm: PASSWORD })).toMatchObject({ ok: false, reason: "REVOKED" });
    const { data: users } = await adminClient().from("users").select("id").eq("email", inv.email);
    expect(users).toEqual([]);

    const { data: logs } = await adminClient().from("audit_logs").select("action_type, changes_summary").eq("target_id", inv.id);
    expect(logs?.find((l) => l.action_type === "INVITATION_CANCEL")?.changes_summary).toMatchObject({ reason: "이메일 오기" });

    // 취소 후에는 같은 차량에 새 초대를 만들 수 있다
    expect((await newDriverInvite("after-revoke")).id).not.toBe("");
  });

  it("수락된 초대는 취소할 수 없고, 다른 조직 초대·조직 관리자 초대는 다룰 수 없다", async () => {
    const inv = await newDriverInvite("used");
    expect((await acceptInvitation(adminClient(), { token: inv.token, password: PASSWORD, passwordConfirm: PASSWORD })).ok).toBe(true);
    expect(await revokeInvitation(inv.client, HWASEONG_ADMIN, { invitationId: inv.id })).toEqual({ ok: false, error: "이미 수락된 초대입니다." });

    await reset();
    const other = await newDriverInvite("cross");
    const seoul = await signedInClient("admin.seoul@pedaleye.test");
    const notFound = { ok: false, error: "초대를 찾을 수 없거나 관리 권한이 없습니다." };
    expect(await revokeInvitation(seoul, SEOUL_ADMIN, { invitationId: other.id })).toEqual(notFound);
    expect(await reissueInvitation(seoul, SEOUL_ADMIN, { invitationId: other.id }, "http://x")).toEqual(notFound);

    const superClient = await signedInClient("super@pedaleye.test");
    const email = `inv-orgadmin-${Date.now()}@pedaleye.test`;
    createdEmails.push(email);
    expect((await createOrgAdminInvitation(superClient, SUPER, { orgId: ORG.hwaseong, name: "관리 후보", email }, "http://x")).ok).toBe(true);
    const { data: adminInv } = await adminClient().from("invitations").select("id").eq("email", email).single();
    expect(await revokeInvitation(other.client, HWASEONG_ADMIN, { invitationId: adminInv?.id })).toEqual(notFound);
    expect((await revokeInvitation(superClient, SUPER, { invitationId: adminInv?.id })).ok).toBe(true);

    // 직접 수정은 권한 자체가 없다
    const direct = await other.client.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", other.id);
    expect(direct.error).not.toBeNull();
  });
});

describe("재발급·목록", () => {
  it("재발급하면 이전 링크는 무효, 새 링크로 가입·차량 배정이 된다", async () => {
    const inv = await newDriverInvite("reissue");
    const reissued = await reissueInvitation(inv.client, HWASEONG_ADMIN, { invitationId: inv.id, expiresInHours: 48 }, "http://x");
    expect(reissued.ok).toBe(true);
    if (!reissued.ok) return;
    expect(reissued.expiresInHours).toBe(48);
    const newToken = tokenOf(reissued.invitationUrl);
    expect(newToken).not.toBe(inv.token);

    expect(await lookupInvitation(adminClient(), inv.token)).toEqual({ valid: false, reason: "REVOKED" });
    expect(await lookupInvitation(adminClient(), newToken)).toMatchObject({ valid: true, email: inv.email, vehiclePlate: "56다 1004" });

    const list = await listInvitations(inv.client, HWASEONG_ADMIN, { ipage: 1 });
    const mine = list.items.filter((i) => i.email === inv.email).map((i) => i.status);
    expect(mine).toEqual(["PENDING", "REVOKED"]); // 최근 순

    expect((await acceptInvitation(adminClient(), { token: newToken, password: PASSWORD, passwordConfirm: PASSWORD })).ok).toBe(true);
    const { data: vehicle } = await adminClient().from("vehicles").select("assigned_user_id").eq("id", VEHICLE.unassigned).single();
    expect(vehicle?.assigned_user_id).not.toBeNull();

    // 수락됐으면 재발급 불가, 상태 필터도 맞다
    const pendingOnly = await listInvitations(inv.client, HWASEONG_ADMIN, { ipage: 1, istatus: "ACCEPTED" });
    expect(pendingOnly.items.every((i) => i.status === "ACCEPTED")).toBe(true);
    const { data: row } = await adminClient().from("invitations").select("id").eq("email", inv.email).not("used_at", "is", null).single();
    expect(await reissueInvitation(inv.client, HWASEONG_ADMIN, { invitationId: row?.id }, "http://x")).toMatchObject({ ok: false });
  });

  it("조직 관리자 목록에는 자기 조직 운전자·조사관 초대만 보인다", async () => {
    await newDriverInvite("scope");
    const seoul = await listInvitations(await signedInClient("admin.seoul@pedaleye.test"), SEOUL_ADMIN, { ipage: 1 });
    expect(seoul.items.every((i) => i.orgName === "서울택시" || i.orgName === null || i.role !== "org_admin")).toBe(true);
    const hw = await listInvitations(await signedInClient("admin.hwaseong@pedaleye.test"), HWASEONG_ADMIN, { ipage: 1 });
    expect(hw.items.every((i) => i.role === "driver" || i.role === "investigator")).toBe(true);
    expect(seoul.items.some((i) => i.vehiclePlate === "56다 1004")).toBe(false);
  });
});
