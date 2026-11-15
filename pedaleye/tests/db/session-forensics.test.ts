import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EVENT_LOG_BUCKET, uploadEventSession } from "@/lib/events/upload";
import { loadSessionForensics } from "@/lib/forensics/session-forensics";
import { buildChainedSession } from "@/lib/telemetry/hash-chain-engine";

import { ORG, adminClient, signedInClient } from "./helpers";

const DEVICE_A = "40000000-0000-0000-0000-000000000001";
const DRIVER_A = { id: "20000000-0000-0000-0000-000000000003", role: "driver", orgId: ORG.hwaseong } as const;
const INVESTIGATOR = { role: "investigator", orgId: ORG.hwaseong } as const;
const SEOUL_ADMIN = { role: "org_admin", orgId: ORG.seoul } as const;
const SUPER = { role: "super_admin", orgId: null } as const;
const START = Date.UTC(2026, 10, 14, 3, 0, 0) + (Date.now() % 100_000) * 1000;

let sessionId = "";
let path = "";
let original: Uint8Array = new Uint8Array();

beforeAll(async () => {
  original = await buildChainedSession(
    DEVICE_A,
    Array.from({ length: 1200 }, (_, i) => ({
      sequenceId: i,
      timestampMs: START + i * 50,
      accelDistance: 12050,
      accelPercent: 0,
      brakeDistance: i >= 600 ? 9500 : 13000,
      brakePercent: i >= 600 ? 100 : 0,
      bothPedal: i >= 590 && i < 600,
      latitudeE7: 375665000,
      longitudeE7: 1269780000,
      speedDeciKmh: i >= 600 ? 0 : 500,
    })),
  );
  const driver = await signedInClient("driver.a@pedaleye.test");
  const result = await uploadEventSession(driver, adminClient(), DRIVER_A, {
    deviceId: DEVICE_A,
    triggerType: "sudden_accel",
    startTime: new Date(START).toISOString(),
    endTime: new Date(START + 1199 * 50).toISOString(),
    rawLogBase64: Buffer.from(original).toString("base64"),
  });
  if (!result.success) throw new Error(result.error);
  sessionId = result.sessionId;
  const { data } = await adminClient().from("event_sessions").select("raw_log_storage_path").eq("id", sessionId).single();
  path = data?.raw_log_storage_path ?? "";
});

afterAll(async () => {
  await adminClient().storage.from(EVENT_LOG_BUCKET).remove([path]);
  await adminClient().from("event_sessions").delete().eq("id", sessionId);
});

describe("세션 포렌식 조회·재검증", () => {
  it("소속 조직 조사관은 원본을 내려받아 전수 검증하고 패킷을 사람이 읽는 단위로 받는다", async () => {
    const client = await signedInClient("investigator.hwaseong@pedaleye.test");
    const result = await loadSessionForensics(client, INVESTIGATOR, sessionId);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({ plateNumber: "12가 3456", deviceSerialNumber: "PE-2026-000001", triggerType: "sudden_accel" });
    expect(result.data.verification).toMatchObject({ isValid: true, totalRecords: 1200 });
    expect(result.data.verification.verificationDurationMs).toBeLessThan(1000);
    expect(result.data.packets).toHaveLength(1200);
    expect(result.data.packets[595]).toMatchObject({ bothPedalFlag: true, brakeDistanceMm: 130 });
  });

  it("super_admin 은 조회 가능, 타 조직 관리자·운전자는 403", async () => {
    const superClient = await signedInClient("super@pedaleye.test");
    expect((await loadSessionForensics(superClient, SUPER, sessionId)).success).toBe(true);

    const seoul = await signedInClient("admin.seoul@pedaleye.test");
    expect(await loadSessionForensics(seoul, SEOUL_ADMIN, sessionId)).toMatchObject({ success: false, status: 403 });

    const driver = await signedInClient("driver.a@pedaleye.test");
    expect(await loadSessionForensics(driver, DRIVER_A, sessionId)).toMatchObject({ success: false, status: 403 });
  });

  it("저장된 원본이 바뀌면 재검증이 변조를 잡고 integrity_verified 를 false 로 맞춘다", async () => {
    const admin = adminClient();
    const tampered = Uint8Array.from(original);
    tampered[700 * 64 + 17]! ^= 0x01; // 패킷 #700 제동 답력
    await admin.storage.from(EVENT_LOG_BUCKET).update(path, tampered, { contentType: "application/octet-stream" });

    const client = await signedInClient("admin.hwaseong@pedaleye.test");
    const result = await loadSessionForensics(client, { role: "org_admin", orgId: ORG.hwaseong }, sessionId, admin);
    expect(result.success && result.data.verification.failureDetail?.failedSequenceId).toBe(701);
    const { data: row } = await admin.from("event_sessions").select("integrity_verified").eq("id", sessionId).single();
    expect(row?.integrity_verified).toBe(false);

    // 원본 복구 후 재검증 → 다시 true
    await admin.storage.from(EVENT_LOG_BUCKET).update(path, original, { contentType: "application/octet-stream" });
    await loadSessionForensics(client, { role: "org_admin", orgId: ORG.hwaseong }, sessionId, admin);
    const { data: restored } = await admin.from("event_sessions").select("integrity_verified").eq("id", sessionId).single();
    expect(restored?.integrity_verified).toBe(true);
  });

  it("원본 파일이 없는 세션은 422, 형식이 아닌 ID 는 404", async () => {
    const client = await signedInClient("investigator.hwaseong@pedaleye.test");
    expect(await loadSessionForensics(client, INVESTIGATOR, "50000000-0000-0000-0000-000000000001")).toMatchObject({ success: false, status: 422 });
    expect(await loadSessionForensics(client, INVESTIGATOR, "not-a-uuid")).toMatchObject({ success: false, status: 404 });
  });

  it("사용자는 event_sessions 를 직접 수정해 검증 결과를 바꿀 수 없다", async () => {
    const client = await signedInClient("admin.hwaseong@pedaleye.test");
    const { error } = await client.from("event_sessions").update({ integrity_verified: false }).eq("id", sessionId);
    expect(error?.code).toBe("42501");
  });
});
