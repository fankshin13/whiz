import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requestOwnAccountDeletion } from "@/lib/account/deletion";

import { ORG, PASSWORD, VEHICLE, adminClient, anonClient, signedInClient } from "./helpers";

// 본인 계정 삭제 요청: 비밀번호로 본인 확인 → 즉시 비활성화(로그인 차단·차량 해제), 기록은 보관 기간까지 유지.
const email = `delete.me.${Date.now()}@pedaleye.test`;
let userId = "";

beforeAll(async () => {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { name: "삭제 요청 운전자" } });
  if (error) throw error;
  userId = data.user.id;
  await admin.from("users").update({ role: "driver", org_id: ORG.hwaseong }).eq("id", userId);
  await admin.from("vehicles").update({ assigned_user_id: userId }).eq("id", VEHICLE.unassigned);
});

afterAll(async () => {
  const admin = adminClient();
  await admin.from("vehicles").update({ assigned_user_id: null }).eq("id", VEHICLE.unassigned);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("본인 계정 삭제 요청", () => {
  it("비밀번호가 틀리면 아무것도 바뀌지 않는다", async () => {
    const result = await requestOwnAccountDeletion({ email, password: "wrong-password-123" });
    expect(result).toEqual({ ok: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." });
    const { data } = await adminClient().from("users").select("is_active").eq("id", userId).single();
    expect(data?.is_active).toBe(true);
  });

  it("본인은 삭제 요청 시각을 직접 바꿀 수 없다(함수로만)", async () => {
    const client = await signedInClient(email);
    const { error } = await client.from("users").update({ deletion_requested_at: new Date().toISOString() }).eq("id", userId);
    expect(error?.message).toMatch(/관리자 기능으로만/);
  });

  it("요청하면 즉시 비활성화·차량 해제·로그인 차단되고 감사 로그에 본인 요청으로 남는다", async () => {
    const result = await requestOwnAccountDeletion({ email, password: PASSWORD, reason: "앱 사용 중단", clientIp: "203.0.113.77" });
    expect(result).toEqual({ ok: true });

    const admin = adminClient();
    const { data: user } = await admin.from("users").select("is_active, deactivated_at, deactivated_by, deletion_requested_at").eq("id", userId).single();
    expect(user).toMatchObject({ is_active: false, deactivated_by: userId });
    expect(user?.deactivated_at).not.toBeNull();
    expect(user?.deletion_requested_at).not.toBeNull();

    const { data: vehicle } = await admin.from("vehicles").select("assigned_user_id").eq("id", VEHICLE.unassigned).single();
    expect(vehicle?.assigned_user_id).toBeNull();

    const signIn = await anonClient().auth.signInWithPassword({ email, password: PASSWORD });
    expect(signIn.error?.code).toBe("user_banned");

    const { data: logs } = await admin
      .from("audit_logs")
      .select("action_type, actor_id, ip_address, changes_summary")
      .eq("target_id", userId)
      .eq("action_type", "USER_DEACTIVATE");
    expect(logs?.[0]).toMatchObject({ actor_id: userId, ip_address: "203.0.113.77" });
    expect(JSON.stringify(logs?.[0]?.changes_summary)).toContain("본인 계정 삭제 요청: 앱 사용 중단");
  });

  it("이미 비활성화된 계정은 다시 요청해도 안내만 한다", async () => {
    const result = await requestOwnAccountDeletion({ email, password: PASSWORD });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/이미 비활성화된 계정/);
  });

  it("슈퍼 관리자는 스스로 삭제 요청할 수 없다", async () => {
    const result = await requestOwnAccountDeletion({ email: "super@pedaleye.test", password: PASSWORD });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/다른 슈퍼 관리자/);
    const { data } = await adminClient().from("users").select("is_active").eq("email", "super@pedaleye.test").single();
    expect(data?.is_active).toBe(true);
  });
});
