import { afterAll, describe, expect, it } from "vitest";

import { acceptInvitation, createOrgAdminInvitation } from "@/lib/invitations/operations";
import { createOrganization, listOrganizationsWithStats, updateOrganization } from "@/lib/organizations/operations";

import { ORG, PASSWORD, VEHICLE, adminClient, anonClient, signedInClient } from "./helpers";

const SUPER = { id: "20000000-0000-0000-0000-000000000001", role: "super_admin", orgId: null } as const;
const HWASEONG_ADMIN = { id: "20000000-0000-0000-0000-000000000002", role: "org_admin", orgId: ORG.hwaseong } as const;
const DRIVER_A = { id: "20000000-0000-0000-0000-000000000003", role: "driver", orgId: ORG.hwaseong } as const;
const INVESTIGATOR = { id: "20000000-0000-0000-0000-000000000005", role: "investigator", orgId: ORG.hwaseong } as const;
const BASE = "http://127.0.0.1:3000";

const createdOrgs: string[] = [];
const createdEmails: string[] = [];
const tokenFrom = (url: string) => new URL(url).searchParams.get("token") ?? "";
const uniqueEmail = (tag: string) => {
  const email = `orgadmin-${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}@pedaleye.test`;
  createdEmails.push(email);
  return email;
};

afterAll(async () => {
  const admin = adminClient();
  await admin.from("invitations").delete().in("email", createdEmails);
  const { data } = await admin.from("users").select("id").in("email", createdEmails);
  for (const user of data ?? []) await admin.auth.admin.deleteUser(user.id);
  if (createdOrgs.length) await admin.from("organizations").delete().in("id", createdOrgs);
});

describe("조직 생성·수정·목록", () => {
  it("슈퍼 관리자가 조직을 만들고 이름·유형을 바꾸며, 목록에 차량·관리자 수가 보인다", async () => {
    const client = await signedInClient("super@pedaleye.test");
    const created = await createOrganization(client, SUPER, { name: "  시험 지자체  ", type: "b2g" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdOrgs.push(created.id);

    expect(await updateOrganization(client, SUPER, { id: created.id, name: "시험 운수사", type: "fleet" })).toEqual({
      ok: true,
      id: created.id,
    });

    const list = await listOrganizationsWithStats(client, SUPER);
    expect(list.find((o) => o.id === created.id)).toMatchObject({ name: "시험 운수사", type: "fleet", vehicleCount: 0, adminCount: 0 });
    // 시드: 화성시 교통안전과 차량 3대, 조직 관리자 1명
    expect(list.find((o) => o.id === ORG.hwaseong)).toMatchObject({ vehicleCount: 3, adminCount: 1 });
  });

  it("입력 오류는 안내하고 저장하지 않는다", async () => {
    const client = await signedInClient("super@pedaleye.test");
    expect(await createOrganization(client, SUPER, { name: "가", type: "fleet" })).toEqual({
      ok: false,
      error: "조직명은 2자 이상이어야 합니다.",
    });
    expect((await createOrganization(client, SUPER, { name: "정상 이름", type: "unknown" })).ok).toBe(false);
    expect(await updateOrganization(client, SUPER, { id: "00000000-0000-0000-0000-000000000000", name: "없는 조직", type: "fleet" })).toEqual({
      ok: false,
      error: "조직을 찾을 수 없습니다.",
    });
  });

  it("조직 관리자·운전자·조사관은 만들거나 바꿀 수 없다(서버 + RLS)", async () => {
    for (const [email, user] of [
      ["admin.hwaseong@pedaleye.test", HWASEONG_ADMIN],
      ["driver.a@pedaleye.test", DRIVER_A],
      ["investigator.hwaseong@pedaleye.test", INVESTIGATOR],
    ] as const) {
      const client = await signedInClient(email);
      expect(await createOrganization(client, user, { name: "몰래 만든 조직", type: "fleet" })).toEqual({
        ok: false,
        error: "조직을 관리할 권한이 없습니다.",
      });
      expect(await listOrganizationsWithStats(client, user)).toEqual([]);

      // 서버 확인을 건너뛰고 직접 넣거나 바꿔도 DB 가 막는다
      const insert = await client.from("organizations").insert({ name: "직접 삽입", type: "fleet" });
      expect(insert.error?.code, email).toBe("42501");
      const update = await client.from("organizations").update({ name: "변조" }).eq("id", ORG.seoul).select("id");
      expect(update.data ?? [], email).toEqual([]);
    }
    const { data } = await adminClient().from("organizations").select("name").eq("id", ORG.seoul).single();
    expect(data?.name).toBe("서울법인택시");
  });
});

describe("조직 관리자 초대", () => {
  it("슈퍼 관리자가 초대 → 수락하면 그 조직의 org_admin 이 되고, 자기 조직 차량만 본다", async () => {
    const superClient = await signedInClient("super@pedaleye.test");
    const email = uniqueEmail("accept");
    const invite = await createOrgAdminInvitation(superClient, SUPER, { orgId: ORG.seoul, name: "서울 관리자2", email, expiresInHours: 12 }, BASE);
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;
    expect(invite.expiresInHours).toBe(12);

    const { data: row } = await adminClient().from("invitations").select("role, vehicle_id").eq("email", email).single();
    expect(row).toEqual({ role: "org_admin", vehicle_id: null });

    const accepted = await acceptInvitation(adminClient(), { token: tokenFrom(invite.invitationUrl), password: PASSWORD, passwordConfirm: PASSWORD });
    expect(accepted).toEqual({ ok: true, email, role: "org_admin" });

    const { data: profile } = await adminClient().from("users").select("role, org_id").eq("email", email).single();
    expect(profile).toEqual({ role: "org_admin", org_id: ORG.seoul });

    const client = anonClient();
    await client.auth.signInWithPassword({ email, password: PASSWORD });
    const { data: vehicles } = await client.from("vehicles").select("id").order("id");
    expect(vehicles?.map((v) => v.id)).toEqual([VEHICLE.driverC]); // 서울법인택시 차량만
  });

  it("조직 관리자·운전자는 조직 관리자 초대를 만들 수 없다(서버 + RLS). 운전자 초대는 그대로 가능", async () => {
    const orgAdmin = await signedInClient("admin.hwaseong@pedaleye.test");
    expect(await createOrgAdminInvitation(orgAdmin, HWASEONG_ADMIN, { orgId: ORG.hwaseong, name: "x", email: uniqueEmail("self") }, BASE)).toEqual({
      ok: false,
      error: "조직 관리자를 초대할 권한이 없습니다.",
    });

    // 서버 확인을 건너뛰고 자기 조직에 org_admin 초대를 직접 넣어도 DB 가 막는다(새 정책)
    const direct = await orgAdmin.from("invitations").insert({
      org_id: ORG.hwaseong,
      email: uniqueEmail("direct"),
      invitee_name: "자가 승격",
      role: "org_admin",
      token_hash: "e".repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_by: HWASEONG_ADMIN.id,
    });
    expect(direct.error?.code).toBe("42501");

    // 운전자 초대(차량 없음)는 조직 관리자에게 여전히 허용
    const driverInvite = await orgAdmin.from("invitations").insert({
      org_id: ORG.hwaseong,
      email: uniqueEmail("driver"),
      invitee_name: "운전자",
      role: "driver",
      token_hash: "d".repeat(63) + "1",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_by: HWASEONG_ADMIN.id,
    });
    expect(driverInvite.error).toBeNull();

    const driver = await signedInClient("driver.a@pedaleye.test");
    expect((await createOrgAdminInvitation(driver, DRIVER_A, { orgId: ORG.hwaseong, name: "x", email: uniqueEmail("drv") }, BASE)).ok).toBe(false);
  });

  it("슈퍼 관리자도 조직 관리자 초대에 차량을 붙일 수 없다(DB 규칙)", async () => {
    const superClient = await signedInClient("super@pedaleye.test");
    const { error } = await superClient.from("invitations").insert({
      org_id: ORG.hwaseong,
      vehicle_id: VEHICLE.unassigned,
      email: uniqueEmail("withcar"),
      invitee_name: "차량 붙은 관리자",
      role: "org_admin",
      token_hash: "c".repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_by: SUPER.id,
    });
    expect(error?.code).toBe("42501");
  });

  it("이미 가입된 이메일·활성 초대가 있는 이메일·없는 조직은 거부", async () => {
    const superClient = await signedInClient("super@pedaleye.test");
    expect(await createOrgAdminInvitation(superClient, SUPER, { orgId: ORG.hwaseong, name: "x", email: "driver.a@pedaleye.test" }, BASE)).toEqual({
      ok: false,
      error: "이미 가입된 이메일입니다. 다른 이메일로 초대해 주세요.",
    });
    const email = uniqueEmail("dup");
    expect((await createOrgAdminInvitation(superClient, SUPER, { orgId: ORG.hwaseong, name: "x", email }, BASE)).ok).toBe(true);
    expect(await createOrgAdminInvitation(superClient, SUPER, { orgId: ORG.hwaseong, name: "x", email }, BASE)).toEqual({
      ok: false,
      error: "이미 해당 이메일로 활성화된 초대가 존재합니다.",
    });
    expect(await createOrgAdminInvitation(superClient, SUPER, { orgId: "00000000-0000-0000-0000-000000000000", name: "x", email: uniqueEmail("noorg") }, BASE)).toEqual({
      ok: false,
      error: "조직을 찾을 수 없습니다.",
    });
  });
});
