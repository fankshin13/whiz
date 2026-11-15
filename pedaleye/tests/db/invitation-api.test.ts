import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST as acceptPost } from "@/app/api/invitations/accept/route";
import { POST as verifyPost } from "@/app/api/invitations/verify/route";
import { createInvitation } from "@/lib/invitations/operations";

import { ORG, PASSWORD, VEHICLE, adminClient, anonClient, signedInClient } from "./helpers";

// 모바일 앱이 쓰는 공개 초대 API(route handler)를 실제 로컬 DB 로 검증한다.
const HWASEONG_ADMIN = { id: "20000000-0000-0000-0000-000000000002", role: "org_admin", orgId: ORG.hwaseong } as const;
const createdEmails: string[] = [];
let ipSeq = 0;

function post(handler: (r: Request) => Promise<Response>, body: unknown, ip = `198.51.100.${(ipSeq += 1)}`) {
  return handler(
    new Request("http://127.0.0.1:3000/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function resetUnassignedVehicle() {
  const admin = adminClient();
  await admin.from("vehicles").update({ assigned_user_id: null }).eq("id", VEHICLE.unassigned);
  await admin.from("invitations").delete().eq("vehicle_id", VEHICLE.unassigned);
}

async function newInvitation(tag: string) {
  const email = `api-${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}@pedaleye.test`;
  createdEmails.push(email);
  const supabase = await signedInClient("admin.hwaseong@pedaleye.test");
  const result = await createInvitation(supabase, HWASEONG_ADMIN, { vehicleId: VEHICLE.unassigned, name: `앱 ${tag}`, email }, "http://x");
  if (!result.ok) throw new Error(result.error);
  return { email, token: new URL(result.invitationUrl).searchParams.get("token") ?? "" };
}

beforeEach(resetUnassignedVehicle);

afterAll(async () => {
  const admin = adminClient();
  await resetUnassignedVehicle();
  const { data } = await admin.from("users").select("id").in("email", createdEmails);
  for (const user of data ?? []) await admin.auth.admin.deleteUser(user.id);
});

describe("POST /api/invitations/verify", () => {
  it("유효한 토큰은 조직명·차량 번호·이메일만 돌려주고 내부 ID·해시는 없다", async () => {
    const invite = await newInvitation("verify");
    const res = await post(verifyPost, { token: invite.token });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      isValid: true,
      email: invite.email,
      inviteeName: "앱 verify",
      orgName: "화성시 교통안전과",
      vehiclePlate: "56다 1004",
    });
  });

  it("형식 오류·없는 토큰은 NOT_FOUND, 잘못된 본문은 400", async () => {
    expect(await (await post(verifyPost, { token: "abc" })).json()).toEqual({ isValid: false, reason: "NOT_FOUND" });
    expect(await (await post(verifyPost, { token: "a".repeat(64) })).json()).toEqual({ isValid: false, reason: "NOT_FOUND" });
    expect((await post(verifyPost, "{not json")).status).toBe(400);
    expect((await post(verifyPost, { token: 123 })).status).toBe(400);
    expect((await post(verifyPost, { token: "a".repeat(5_000) })).status).toBe(413);
  });

  it("같은 IP 에서 1분에 20회를 넘으면 429", async () => {
    const ip = "203.0.113.77";
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) statuses.push((await post(verifyPost, { token: "abc" }, ip)).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe("POST /api/invitations/accept", () => {
  it("수락하면 계정·차량 배정이 끝나고 같은 비밀번호로 로그인된다. 재사용은 ALREADY_USED", async () => {
    const invite = await newInvitation("accept");
    const res = await post(acceptPost, { token: invite.token, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, email: invite.email, role: "driver" });

    const client = anonClient();
    const { data: session, error } = await client.auth.signInWithPassword({ email: invite.email, password: PASSWORD });
    expect(error).toBeNull();
    const { data: vehicle } = await client.from("vehicles").select("id").eq("assigned_user_id", session.user?.id ?? "").maybeSingle();
    expect(vehicle?.id).toBe(VEHICLE.unassigned);

    const again = await post(acceptPost, { token: invite.token, password: PASSWORD });
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ success: false, error: "ALREADY_USED" });
    expect(await (await post(verifyPost, { token: invite.token })).json()).toEqual({ isValid: false, reason: "ALREADY_USED" });
  });

  it("만료된 토큰은 EXPIRED 로 거부되고 계정이 생기지 않는다", async () => {
    const invite = await newInvitation("expired");
    await adminClient()
      .from("invitations")
      .update({ created_at: new Date(Date.now() - 7_200_000).toISOString(), expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("email", invite.email);

    const res = await post(acceptPost, { token: invite.token, password: PASSWORD });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "EXPIRED" });
    const { data } = await adminClient().from("users").select("id").eq("email", invite.email);
    expect(data).toEqual([]);
  });

  it("8자 미만 비밀번호는 INVALID_INPUT 과 안내 문구로 거부된다", async () => {
    const invite = await newInvitation("short");
    const res = await post(acceptPost, { token: invite.token, password: "short" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "INVALID_INPUT", message: "비밀번호는 8자 이상이어야 합니다." });
  });
});
