import { createHash, createPrivateKey, sign } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { sealMessage } from "@/lib/events/device-seal";
import { EVENT_LOG_BUCKET, uploadEventSession } from "@/lib/events/upload";
import { loadSessionForensics } from "@/lib/forensics/session-forensics";
import { buildChainedSession, toHex } from "@/lib/telemetry/hash-chain-engine";
import type { PacketPayload } from "@/lib/telemetry/packet-codec";

import { DEVICE, ORG, adminClient, signedInClient } from "./helpers";

// 단말이 만든 사고 기록(BLE): 일련번호 기준 체인 + 단말 봉인 서명. 시드의 PE-2026-000001 에는 시험 벡터 공개키가 등록돼 있다.
const DRIVER_A = { id: "20000000-0000-0000-0000-000000000003", role: "driver", orgId: ORG.hwaseong } as const;
const SERIAL = "PE-2026-000001";
const seed = createHash("sha256").update("PEDALEYE-TEST-DEVICE-KEY-1").digest();
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
const BASE = Date.UTC(2026, 10, 16, 2, 0, 0) + (Date.now() % 100_000) * 1000;
const created: string[] = [];

async function deviceSession(startMs: number, index: number, tamper = false) {
  const payloads: PacketPayload[] = Array.from({ length: 600 }, (_, i) => ({
    sequenceId: i,
    timestampMs: startMs + i * 20,
    accelDistance: 12050,
    accelPercent: 0,
    brakeDistance: i >= 300 ? 9500 : 13000,
    brakePercent: i >= 300 ? 100 : 0,
    bothPedal: false,
    latitudeE7: 375665000,
    longitudeE7: 1269780000,
    speedDeciKmh: i >= 300 ? 0 : 500,
  }));
  const bytes = await buildChainedSession(SERIAL, payloads); // 단말은 일련번호로 체인을 시작한다
  const finalHash = bytes.subarray(bytes.length - 32);
  const seal = sign(null, sealMessage({ serial: SERIAL, sessionIndex: index, startMs, recordCount: 600, finalHash }), privateKey);
  if (tamper) bytes[64 * 420 + 17] = (bytes[64 * 420 + 17] ?? 0) ^ 0x01; // 레코드 #420 제동 값 1비트 변조(봉인은 원본 기준)
  return {
    input: (overrides: Record<string, unknown> = {}) => ({
      deviceId: DEVICE.driverA,
      triggerType: "shock",
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(startMs + 599 * 20).toISOString(),
      rawLogBase64: Buffer.from(bytes).toString("base64"),
      deviceSessionIndex: index,
      sealSignature: seal.toString("base64"),
      ...overrides,
    }),
  };
}

afterAll(async () => {
  const admin = adminClient();
  const { data } = await admin.from("event_sessions").select("raw_log_storage_path").in("id", created);
  const paths = (data ?? []).flatMap((r) => (r.raw_log_storage_path ? [r.raw_log_storage_path] : []));
  if (paths.length) await admin.storage.from(EVENT_LOG_BUCKET).remove(paths);
  await admin.from("event_sessions").delete().in("id", created);
});

describe("단말 봉인 기록 업로드", () => {
  it("일련번호 체인 + 올바른 봉인은 검증 통과, 같은 기록을 다시 올리면 기존 세션을 돌려준다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const { input } = await deviceSession(BASE, 7);
    const result = await uploadEventSession(driver, adminClient(), DRIVER_A, input());
    expect(result).toMatchObject({ success: true, integrityVerified: true, deviceSealVerified: true, duplicate: false, recordCount: 600 });
    if (!result.success) return;
    created.push(result.sessionId);

    const again = await uploadEventSession(driver, adminClient(), DRIVER_A, input());
    expect(again).toMatchObject({ success: true, sessionId: result.sessionId, duplicate: true });

    const { data } = await adminClient().from("event_sessions").select("device_session_index, device_seal_verified, integrity_verified").eq("id", result.sessionId).single();
    expect(data).toEqual({ device_session_index: 7, device_seal_verified: true, integrity_verified: true });

    // 상세·보고서 재검증도 일련번호 기준 체인으로 통과
    const forensics = await loadSessionForensics(driver, DRIVER_A, result.sessionId);
    expect(forensics).toMatchObject({ success: true, data: { deviceSealed: "verified", verification: { isValid: true } } });
  });

  it("봉인이 틀리거나(다른 세션 번호), 내용이 변조되면 검증 실패로 저장되고 중복으로 합치지 않는다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const wrongSeal = await uploadEventSession(driver, adminClient(), DRIVER_A, (await deviceSession(BASE + 60_000, 8)).input({ deviceSessionIndex: 9 }));
    expect(wrongSeal).toMatchObject({ success: true, integrityVerified: false, deviceSealVerified: false });
    if (wrongSeal.success) created.push(wrongSeal.sessionId);

    const tampered = await uploadEventSession(driver, adminClient(), DRIVER_A, (await deviceSession(BASE + 120_000, 10, true)).input());
    expect(tampered).toMatchObject({ success: true, integrityVerified: false, brokenSequenceId: 421 });
    if (tampered.success) created.push(tampered.sessionId);

    if (wrongSeal.success) {
      const forensics = await loadSessionForensics(driver, DRIVER_A, wrongSeal.sessionId);
      expect(forensics).toMatchObject({ success: true, data: { deviceSealed: "invalid", verification: { isValid: false } } });
    }
  });

  it("봉인 정보는 둘 다 있어야 하고, 봉인 기록을 단말 ID 체인으로 바꿔 올려도 통과하지 못한다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const { input } = await deviceSession(BASE + 180_000, 11);
    expect(await uploadEventSession(driver, adminClient(), DRIVER_A, input({ sealSignature: undefined }))).toMatchObject({ success: false, status: 400 });

    // 봉인 없이 올리면 단말 ID 기준 체인으로 검증 → 일련번호 체인 파일은 실패
    const unsealed = await uploadEventSession(driver, adminClient(), DRIVER_A, input({ sealSignature: undefined, deviceSessionIndex: undefined }));
    expect(unsealed).toMatchObject({ success: true, integrityVerified: false });
    if (unsealed.success) created.push(unsealed.sessionId);
    expect(toHex(new Uint8Array(32))).toHaveLength(64);
  });
});
