import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EVENT_LOG_BUCKET } from "@/lib/events/upload";
import { runRecordRetention } from "@/lib/retention/records";

import { ORG, PASSWORD, adminClient, anonClient, signedInClient } from "./helpers";

// 보관 기간 자동 파기: 계정은 비활성화 후 1년 익명화, 사고 기록은 생성 후 3년 파기(법적 보존 제외).
const DEVICE_A = "40000000-0000-0000-0000-000000000001";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const stamp = Date.now();
const users: Record<string, string> = {};
const sessions: Record<string, string> = {};

async function makeUser(key: string, deactivatedDaysAgo: number | null) {
  const admin = adminClient();
  const email = `retention.${key}.${stamp}@pedaleye.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { name: `보관 시험 ${key}` } });
  if (error) throw error;
  users[key] = data.user.id;
  await admin
    .from("users")
    .update({
      role: "driver",
      org_id: ORG.hwaseong,
      ...(deactivatedDaysAgo === null ? {} : { is_active: false, deactivated_at: ago(deactivatedDaysAgo) }),
    })
    .eq("id", data.user.id);
  return email;
}

async function makeSession(key: string, createdDaysAgo: number, withFile = true) {
  const admin = adminClient();
  const start = Date.UTC(2020, 0, 1) + (stamp % 1_000_000) * 1000 + Object.keys(sessions).length * 60_000;
  const path = `raw_logs/${DEVICE_A}/retention-test/${key}-${stamp}.pel`;
  if (withFile) {
    const up = await admin.storage.from(EVENT_LOG_BUCKET).upload(path, new Uint8Array(96), { contentType: "application/octet-stream" });
    if (up.error) throw up.error;
  }
  const { data, error } = await admin
    .from("event_sessions")
    .insert({
      device_id: DEVICE_A,
      trigger_type: "manual",
      start_time: new Date(start).toISOString(),
      end_time: new Date(start + 1000).toISOString(),
      record_count: 1,
      initial_chain_hash: "a".repeat(64),
      final_chain_hash: `${key}${stamp}`.padEnd(64, "0").slice(0, 64),
      integrity_verified: true,
      raw_log_storage_path: withFile ? path : null,
      created_at: ago(createdDaysAgo),
    })
    .select("id")
    .single();
  if (error) throw error;
  sessions[key] = data.id;
  return path;
}

const paths: Record<string, string> = {};

beforeAll(async () => {
  await makeUser("expired", 400);
  await makeUser("recent", 200);
  await makeUser("active", null);
  // 만료 계정이 받은 초대(이름·이메일)도 함께 익명화되는지 본다
  const admin = adminClient();
  const { error: inviteError } = await admin.from("invitations").insert({
    org_id: ORG.hwaseong,
    email: `retention.expired.${stamp}@pedaleye.test`,
    invitee_name: "보관 시험 expired",
    role: "driver",
    token_hash: `retention-${stamp}`.padEnd(64, "0"),
    expires_at: ago(390),
    used_at: ago(395),
    accepted_user_id: users.expired,
    created_by: "20000000-0000-0000-0000-000000000002",
    created_at: ago(400),
  });
  if (inviteError) throw inviteError;
  paths.old = await makeSession("old", 1200);
  paths.held = await makeSession("held", 1200);
  paths.young = await makeSession("young", 900);
});

afterAll(async () => {
  const admin = adminClient();
  await admin.from("invitations").delete().eq("accepted_user_id", users.expired!);
  await admin.from("event_sessions").delete().in("id", Object.values(sessions));
  await admin.storage.from(EVENT_LOG_BUCKET).remove(Object.values(paths));
  for (const id of Object.values(users)) await admin.auth.admin.deleteUser(id);
});

describe("법적 보존 표시", () => {
  it("슈퍼 관리자만, 사유와 함께 표시할 수 있고 감사 로그에 남는다", async () => {
    const orgAdmin = await signedInClient("admin.hwaseong@pedaleye.test");
    const denied = await orgAdmin.rpc("set_event_legal_hold", { p_session_id: sessions.held!, p_hold: true, p_reason: "사건" });
    expect(denied.error?.code).toBe("42501");

    const superClient = await signedInClient("super@pedaleye.test");
    const noReason = await superClient.rpc("set_event_legal_hold", { p_session_id: sessions.held!, p_hold: true });
    expect(noReason.error?.message).toMatch(/REASON_REQUIRED/);
    const ok = await superClient.rpc("set_event_legal_hold", { p_session_id: sessions.held!, p_hold: true, p_reason: "2026가단12345" });
    expect(ok.error).toBeNull();

    const { data } = await adminClient().from("event_sessions").select("legal_hold, legal_hold_reason").eq("id", sessions.held!).single();
    expect(data).toMatchObject({ legal_hold: true, legal_hold_reason: "2026가단12345" });
    const { data: logs } = await adminClient().from("audit_logs").select("action_type, org_id").eq("target_id", sessions.held!).eq("action_type", "EVENT_LEGAL_HOLD");
    expect(logs?.[0]).toMatchObject({ org_id: ORG.hwaseong });
  });
});

describe("자동 파기", () => {
  it("만료 계정은 익명화되고, 3년 지난 기록은 파일과 함께 파기된다(보존 표시·기간 미달은 남는다)", async () => {
    const result = await runRecordRetention(adminClient());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.anonymizedAccounts).toBeGreaterThanOrEqual(1);
    expect(result.purgedEvents).toBeGreaterThanOrEqual(1);
    expect(result.skippedEvents).toBe(0);

    const admin = adminClient();
    const { data: rows } = await admin.from("users").select("id, name, email, anonymized_at").in("id", Object.values(users));
    const byId = Object.fromEntries((rows ?? []).map((r) => [r.id, r]));
    expect(byId[users.expired!]).toMatchObject({ name: "삭제된 사용자", email: `deleted+${users.expired}@invalid.pedaleye` });
    expect(byId[users.expired!]?.anonymized_at).not.toBeNull();
    expect(byId[users.recent!]?.anonymized_at).toBeNull();
    expect(byId[users.active!]?.anonymized_at).toBeNull();

    const { data: invitation } = await admin.from("invitations").select("email, invitee_name").eq("accepted_user_id", users.expired!).single();
    expect(invitation).toEqual({ email: `deleted+${users.expired}@invalid.pedaleye`, invitee_name: "삭제된 사용자" });

    // 원래 이메일로는 더 이상 로그인할 수 없다
    const signIn = await anonClient().auth.signInWithPassword({ email: `retention.expired.${stamp}@pedaleye.test`, password: PASSWORD });
    expect(signIn.error).not.toBeNull();

    const { data: left } = await admin.from("event_sessions").select("id").in("id", Object.values(sessions));
    const ids = (left ?? []).map((r) => r.id);
    expect(ids).not.toContain(sessions.old);
    expect(ids).toContain(sessions.held);
    expect(ids).toContain(sessions.young);
    expect((await admin.storage.from(EVENT_LOG_BUCKET).download(paths.old!)).error).not.toBeNull();
    expect((await admin.storage.from(EVENT_LOG_BUCKET).download(paths.held!)).error).toBeNull();

    const { data: logs } = await admin.from("audit_logs").select("action_type, changes_summary").in("action_type", ["USER_ANONYMIZE", "EVENT_PURGE"]).order("created_at", { ascending: false }).limit(2);
    expect(logs?.map((l) => l.action_type).sort()).toEqual(["EVENT_PURGE", "USER_ANONYMIZE"]);
  });

  it("보존 표시를 해제하면 다음 실행에서 파기된다", async () => {
    const superClient = await signedInClient("super@pedaleye.test");
    await superClient.rpc("set_event_legal_hold", { p_session_id: sessions.held!, p_hold: false });
    const result = await runRecordRetention(adminClient());
    expect(result.status).toBe("ok");
    const { data } = await adminClient().from("event_sessions").select("id").eq("id", sessions.held!);
    expect(data).toEqual([]);
  });

  it("서버 전용 함수는 로그인 사용자가 호출할 수 없다", async () => {
    const superClient = await signedInClient("super@pedaleye.test");
    expect((await superClient.rpc("anonymize_expired_accounts")).error?.code).toBe("42501");
    expect((await superClient.rpc("purge_event_sessions", { p_ids: [sessions.young!] })).error?.code).toBe("42501");
    expect((await superClient.rpc("list_expired_event_sessions", {})).error?.code).toBe("42501");
  });
});
