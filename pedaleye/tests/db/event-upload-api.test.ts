import { afterAll, describe, expect, it, vi } from "vitest";

// revalidatePath 는 Next 서버 실행 중에만 동작하므로 테스트에서는 빈 함수로 둔다
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "@/app/api/events/upload/route";
import { EVENT_LOG_BUCKET } from "@/lib/events/upload";
import { buildChainedSession } from "@/lib/telemetry/hash-chain-engine";

import { PASSWORD, adminClient, anonClient } from "./helpers";

// 모바일 앱의 업로드 API(Bearer 토큰)를 실제 로컬 DB 로 검증한다.
const DEVICE_A = "40000000-0000-0000-0000-000000000001"; // driver.a 차량
const DEVICE_B = "40000000-0000-0000-0000-000000000002"; // driver.b 차량
const created: string[] = [];
let ipSeq = 0;

async function tokenOf(email: string) {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`${email} 로그인 실패`);
  return data.session.access_token;
}

async function sessionBytes(deviceId: string, startMs: number) {
  return buildChainedSession(
    deviceId,
    Array.from({ length: 1200 }, (_, i) => ({
      sequenceId: i,
      timestampMs: startMs + i * 50,
      accelDistance: 10520,
      accelPercent: 38,
      brakeDistance: i >= 600 ? 9500 : 13000,
      brakePercent: i >= 600 ? 100 : 0,
      bothPedal: false,
      latitudeE7: 0,
      longitudeE7: 0,
      speedDeciKmh: 0,
    })),
  );
}

function body(deviceId: string, bytes: Uint8Array, startMs: number, extra: Record<string, unknown> = {}) {
  return {
    deviceId,
    triggerType: "sudden_accel",
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(startMs + 1199 * 50).toISOString(),
    rawLogBase64: Buffer.from(bytes).toString("base64"),
    ...extra,
  };
}

async function post(payload: unknown, token?: string) {
  const response = await POST(
    new Request("http://127.0.0.1:3000/api/events/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${(ipSeq += 1)}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    }),
  );
  const json = (await response.json()) as Record<string, unknown>;
  if (typeof json.sessionId === "string") created.push(json.sessionId);
  return { status: response.status, json };
}

afterAll(async () => {
  const admin = adminClient();
  const { data } = await admin.from("event_sessions").select("id, raw_log_storage_path").in("id", created);
  const paths = (data ?? []).flatMap((row) => (row.raw_log_storage_path ? [row.raw_log_storage_path] : []));
  if (paths.length) await admin.storage.from(EVENT_LOG_BUCKET).remove(paths);
  await admin.from("event_sessions").delete().in("id", created);
});

describe("POST /api/events/upload (모바일 앱)", () => {
  it("운전자 토큰으로 본인 단말 세션을 올리면 서버 검증 통과로 저장되고, 다시 올려도 같은 세션", async () => {
    const token = await tokenOf("driver.a@pedaleye.test");
    const start = Date.UTC(2026, 10, 15, 3, 0, 0);
    const bytes = await sessionBytes(DEVICE_A, start);

    const first = await post(body(DEVICE_A, bytes, start), token);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ success: true, recordCount: 1200, integrityVerified: true, duplicate: false });

    const again = await post(body(DEVICE_A, bytes, start), token);
    expect(again.json).toMatchObject({ success: true, duplicate: true, sessionId: first.json.sessionId });

    const { count } = await adminClient()
      .from("event_sessions")
      .select("id", { count: "exact", head: true })
      .eq("device_id", DEVICE_A)
      .eq("start_time", new Date(start).toISOString());
    expect(count).toBe(1);

    // 운전자 본인은 RLS 로 이 세션을 볼 수 있다
    const client = anonClient();
    await client.auth.signInWithPassword({ email: "driver.a@pedaleye.test", password: PASSWORD });
    const { data } = await client.from("event_sessions").select("id, integrity_verified").eq("id", String(first.json.sessionId));
    expect(data).toEqual([{ id: first.json.sessionId, integrity_verified: true }]);
  });

  it("1비트 변조본은 앱이 integrityVerified=true 를 보내도 서버 판정(false)으로 저장된다", async () => {
    const token = await tokenOf("driver.a@pedaleye.test");
    const start = Date.UTC(2026, 10, 15, 3, 10, 0);
    const bytes = await sessionBytes(DEVICE_A, start);
    bytes[500 * 64 + 14]! ^= 0x01;

    const res = await post(body(DEVICE_A, bytes, start, { integrityVerified: true, integrity_verified: true }), token);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ success: true, integrityVerified: false, brokenSequenceId: 501 });
    const { data } = await adminClient().from("event_sessions").select("integrity_verified").eq("id", String(res.json.sessionId)).single();
    expect(data?.integrity_verified).toBe(false);
  });

  it("토큰이 없거나 위조면 401, 다른 운전자 단말이면 403", async () => {
    const start = Date.UTC(2026, 10, 15, 3, 20, 0);
    const bytesB = await sessionBytes(DEVICE_B, start);
    expect((await post(body(DEVICE_B, bytesB, start))).status).toBe(401);
    expect((await post(body(DEVICE_B, bytesB, start), "eyJhbGciOiJIUzI1NiJ9.e30.invalidsignature")).status).toBe(401);

    const token = await tokenOf("driver.a@pedaleye.test");
    expect(await post(body(DEVICE_B, bytesB, start), token)).toMatchObject({ status: 403, json: { success: false } });
  });

  it("형식이 틀린 본문은 400", async () => {
    const token = await tokenOf("driver.a@pedaleye.test");
    expect((await post({ deviceId: DEVICE_A }, token)).status).toBe(400);
  });
});
