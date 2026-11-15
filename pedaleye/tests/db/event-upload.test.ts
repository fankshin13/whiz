import { afterAll, describe, expect, it } from "vitest";

import { EVENT_LOG_BUCKET, uploadEventSession } from "@/lib/events/upload";
import { buildChainedSession } from "@/lib/telemetry/hash-chain-engine";
import type { PacketPayload } from "@/lib/telemetry/packet-codec";

import { ORG, adminClient, signedInClient } from "./helpers";

const DEVICE_A = "40000000-0000-0000-0000-000000000001"; // driver.a 차량
const DEVICE_B = "40000000-0000-0000-0000-000000000002"; // driver.b 차량
const DEVICE_C = "40000000-0000-0000-0000-000000000003"; // 서울
const DRIVER_A = { id: "20000000-0000-0000-0000-000000000003", role: "driver", orgId: ORG.hwaseong } as const;
const HWASEONG_ADMIN = { id: "20000000-0000-0000-0000-000000000002", role: "org_admin", orgId: ORG.hwaseong } as const;
const SEOUL_ADMIN = { id: "20000000-0000-0000-0000-000000000006", role: "org_admin", orgId: ORG.seoul } as const;
const INVESTIGATOR = { id: "20000000-0000-0000-0000-000000000005", role: "investigator", orgId: ORG.hwaseong } as const;

const BASE = Date.UTC(2026, 10, 15, 1, 0, 0) + (Date.now() % 100_000) * 1000; // 실행마다 다른 시각
const created: string[] = [];

async function session(deviceId: string, startMs: number, count = 1200) {
  const payloads: PacketPayload[] = Array.from({ length: count }, (_, i) => ({
    sequenceId: i,
    timestampMs: startMs + i * 50,
    accelDistance: 12050,
    accelPercent: 0,
    brakeDistance: i >= 600 ? 9500 : 13000,
    brakePercent: i >= 600 ? 100 : 0,
    bothPedal: false,
    latitudeE7: 375665000,
    longitudeE7: 1269780000,
    speedDeciKmh: i >= 600 ? 0 : 500,
  }));
  const bytes = await buildChainedSession(deviceId, payloads);
  return {
    bytes,
    input: (overrides: Record<string, unknown> = {}) => ({
      deviceId,
      triggerType: "sudden_accel",
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(startMs + (count - 1) * 50).toISOString(),
      rawLogBase64: Buffer.from(bytes).toString("base64"),
      ...overrides,
    }),
  };
}

afterAll(async () => {
  const admin = adminClient();
  const { data } = await admin.from("event_sessions").select("id, raw_log_storage_path").in("id", created);
  const paths = (data ?? []).flatMap((row) => (row.raw_log_storage_path ? [row.raw_log_storage_path] : []));
  if (paths.length) await admin.storage.from(EVENT_LOG_BUCKET).remove(paths);
  await admin.from("event_sessions").delete().in("id", created);
});

describe("사고 세션 업로드", () => {
  it("배정 운전자가 올린 정상 세션은 검증 통과로 저장되고, 본인이 조회·다운로드할 수 있다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const { input } = await session(DEVICE_A, BASE);
    const result = await uploadEventSession(driver, adminClient(), DRIVER_A, input());
    expect(result).toMatchObject({ success: true, recordCount: 1200, integrityVerified: true, duplicate: false });
    if (!result.success) return;
    created.push(result.sessionId);

    const { data: row } = await driver
      .from("event_sessions")
      .select("record_count, integrity_verified, final_chain_hash, raw_log_storage_path, trigger_type")
      .eq("id", result.sessionId)
      .single();
    expect(row).toMatchObject({ record_count: 1200, integrity_verified: true, final_chain_hash: result.finalHash, trigger_type: "sudden_accel" });
    expect(row?.raw_log_storage_path).toMatch(new RegExp(`^raw_logs/${DEVICE_A}/\\d{4}-\\d{2}/${result.sessionId}\\.pel$`));

    const download = await driver.storage.from(EVENT_LOG_BUCKET).download(row?.raw_log_storage_path ?? "");
    expect(download.error).toBeNull();
    expect(download.data?.size).toBe(1200 * 64 + 32);

    // 업로드하면 단말 동기화 시각이 갱신된다(관제 '정상/주의' 판정 근거)
    const { data: synced } = await adminClient().from("devices").select("last_synced_at").eq("id", DEVICE_A).single();
    expect(Date.now() - Date.parse(synced?.last_synced_at ?? "0")).toBeLessThan(60_000);

    // 같은 세션 재업로드 → 새로 만들지 않고 기존 세션 반환
    const again = await uploadEventSession(driver, adminClient(), DRIVER_A, input());
    expect(again).toMatchObject({ success: true, sessionId: result.sessionId, duplicate: true });

    // 같은 세션을 1비트 변조해 다시 올리면 기존 정상 세션에 합쳐지지 않고 따로 '검증 실패'로 남는다
    const { bytes: copy } = await session(DEVICE_A, BASE);
    copy[350 * 64 + 14]! ^= 0x01;
    const tampered = await uploadEventSession(driver, adminClient(), DRIVER_A, input({ rawLogBase64: Buffer.from(copy).toString("base64") }));
    expect(tampered).toMatchObject({ success: true, integrityVerified: false, duplicate: false, brokenSequenceId: 351 });
    if (tampered.success) {
      created.push(tampered.sessionId);
      expect(tampered.sessionId).not.toBe(result.sessionId);
    }

    // 타 조직 관리자는 그 파일을 받을 수 없다
    const seoul = await signedInClient("admin.seoul@pedaleye.test");
    const denied = await seoul.storage.from(EVENT_LOG_BUCKET).download(row?.raw_log_storage_path ?? "");
    expect(denied.data).toBeNull();
  });

  it("1비트 변조 세션은 저장하되 검증 실패와 변조 위치를 남긴다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const { bytes, input } = await session(DEVICE_A, BASE + 3_600_000);
    bytes[350 * 64 + 14]! ^= 0x01;
    const result = await uploadEventSession(driver, adminClient(), DRIVER_A, input({ rawLogBase64: Buffer.from(bytes).toString("base64") }));
    expect(result).toMatchObject({ success: true, integrityVerified: false, brokenSequenceId: 351 });
    if (result.success) created.push(result.sessionId);
  });

  it("다른 단말의 체인을 이 단말 것으로 올리면 제네시스 불일치로 검증 실패", async () => {
    const admin = await signedInClient("admin.hwaseong@pedaleye.test");
    const { input } = await session(DEVICE_B, BASE + 7_200_000);
    const result = await uploadEventSession(admin, adminClient(), HWASEONG_ADMIN, input({ deviceId: DEVICE_A }));
    expect(result).toMatchObject({ success: true, integrityVerified: false });
    if (result.success) created.push(result.sessionId);
  });

  it("타인·타 조직 단말, 조사관 업로드는 403 이고 아무것도 남지 않는다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const { input: forB } = await session(DEVICE_B, BASE + 10_800_000, 10);
    expect(await uploadEventSession(driver, adminClient(), DRIVER_A, forB())).toMatchObject({ success: false, status: 403 });

    const seoul = await signedInClient("admin.seoul@pedaleye.test");
    const { input: forA } = await session(DEVICE_A, BASE + 10_800_000, 10);
    expect(await uploadEventSession(seoul, adminClient(), SEOUL_ADMIN, forA())).toMatchObject({ success: false, status: 403 });

    const investigator = await signedInClient("investigator.hwaseong@pedaleye.test");
    expect(await uploadEventSession(investigator, adminClient(), INVESTIGATOR, forA())).toMatchObject({ success: false, status: 403 });

    const { count } = await adminClient()
      .from("event_sessions")
      .select("id", { count: "exact", head: true })
      .eq("start_time", new Date(BASE + 10_800_000).toISOString());
    expect(count).toBe(0);

    const { input: forC } = await session(DEVICE_C, BASE + 10_800_000, 10);
    expect(await uploadEventSession(driver, adminClient(), DRIVER_A, forC())).toMatchObject({ success: false, status: 403 });
  });

  it("길이·시각이 맞지 않는 파일은 400", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const { bytes, input } = await session(DEVICE_A, BASE + 14_400_000, 10);
    const truncated = Buffer.from(bytes.subarray(0, bytes.length - 1)).toString("base64");
    expect(await uploadEventSession(driver, adminClient(), DRIVER_A, input({ rawLogBase64: truncated }))).toMatchObject({ success: false, status: 400 });
    const wrongStart = new Date(BASE).toISOString();
    expect(await uploadEventSession(driver, adminClient(), DRIVER_A, input({ startTime: wrongStart }))).toMatchObject({ success: false, status: 400 });
  });

  it("로그인 사용자는 event_sessions 를 직접 만들어 검증 결과를 위조할 수 없다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const { error } = await driver.from("event_sessions").insert({
      device_id: DEVICE_A,
      trigger_type: "manual",
      start_time: new Date(BASE).toISOString(),
      end_time: new Date(BASE + 1000).toISOString(),
      initial_chain_hash: "0".repeat(64),
      final_chain_hash: "f".repeat(64),
      integrity_verified: true,
    });
    expect(error?.code).toBe("42501");
  });
});
