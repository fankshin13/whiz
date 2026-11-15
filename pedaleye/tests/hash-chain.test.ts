import { describe, expect, it } from "vitest";

import { AdaptiveSampler } from "@/lib/telemetry/adaptive-sampler";
import { EventRecorder, detectTrigger, type SensorSample } from "@/lib/telemetry/event-buffer-freezer";
import { buildChainedSession, computeGenesisHash, toHex, verifyBinaryHashChain } from "@/lib/telemetry/hash-chain-engine";
import { mockPedalHardwareStream, type DriveSegment } from "@/lib/telemetry/mock-hardware-stream";
import { PACKET_SIZE, decodePacketRecord, encodePacketRecord, type PacketPayload } from "@/lib/telemetry/packet-codec";

const DEVICE = "40000000-0000-0000-0000-000000000001";
const START = Date.UTC(2026, 10, 15, 0, 0, 0); // 2026-11-15 09:00 KST

const payload = (i: number): PacketPayload => ({
  sequenceId: i,
  timestampMs: START + i * 50,
  accelDistance: 10520,
  accelPercent: 38,
  brakeDistance: 13000,
  brakePercent: 0,
  bothPedal: false,
  latitudeE7: 375665000,
  longitudeE7: 1269780000,
  speedDeciKmh: 655,
});

async function sessionOf(count: number) {
  return buildChainedSession(DEVICE, Array.from({ length: count }, (_, i) => payload(i)));
}

describe("64바이트 패킷 코덱 (Little-Endian)", () => {
  it("모든 필드가 손실 없이 왕복한다", () => {
    const record = { ...payload(7), bothPedal: true, latitudeE7: -123456789, prevHash: new Uint8Array(32).fill(0xab) };
    const bytes = encodePacketRecord(record);
    expect(bytes.length).toBe(64);
    expect(decodePacketRecord(bytes, 0)).toEqual(record);
  });

  it("오프셋 배치가 명세와 같다", () => {
    const bytes = encodePacketRecord({ ...payload(0x01020304), prevHash: new Uint8Array(32) });
    expect([...bytes.slice(0, 4)]).toEqual([0x04, 0x03, 0x02, 0x01]); // LE
    expect(bytes[12]! | (bytes[13]! << 8)).toBe(10520); // Accel_Distance
    expect(bytes[14]).toBe(38); // Accel_Percentage
    expect(bytes[19]).toBe(0); // Reserved
    expect(bytes[28]! | (bytes[29]! << 8)).toBe(655); // GPS_Speed_Kmh
  });

  it("범위를 벗어난 값은 거부한다", () => {
    expect(() => encodePacketRecord({ ...payload(0), accelPercent: 101, prevHash: new Uint8Array(32) })).toThrow(RangeError);
    expect(() => encodePacketRecord({ ...payload(0), prevHash: new Uint8Array(31) })).toThrow(RangeError);
  });
});

describe("SHA-256 해시 체인", () => {
  it("1,200개 정상 체인은 통과하고, 시작 해시는 제네시스와 같다", async () => {
    const bytes = await sessionOf(1200);
    expect(bytes.length).toBe(1200 * 64 + 32);
    const genesis = toHex(await computeGenesisHash(DEVICE, START));
    const result = await verifyBinaryHashChain(bytes, { expectedInitialHash: genesis });
    expect(result).toMatchObject({ isValid: true, totalRecords: 1200, initialHash: genesis });
    expect(result.finalHash).toBe(toHex(bytes.subarray(1200 * 64)));
  });

  it("패킷 #500 의 1비트 변조 → #501 에서 불일치", async () => {
    const bytes = await sessionOf(1200);
    bytes[500 * 64 + 14]! ^= 0x01;
    expect(await verifyBinaryHashChain(bytes)).toMatchObject({ isValid: false, brokenSequenceId: 501, reason: "PREV_HASH_MISMATCH" });
  });

  it("어느 위치의 1바이트를 고쳐도 잡힌다(첫·마지막 패킷, 해시 영역, 끝 해시 포함)", async () => {
    const original = await sessionOf(50);
    const genesis = toHex(await computeGenesisHash(DEVICE, START));
    for (const position of [0, 14, 40, 63, 64 * 25 + 5, 64 * 49 + 3, 64 * 49 + 50, 50 * 64 + 10]) {
      const bytes = Uint8Array.from(original);
      bytes[position]! ^= 0x80;
      const result = await verifyBinaryHashChain(bytes, { expectedInitialHash: genesis });
      expect(result.isValid, `position ${position}`).toBe(false);
    }
  });

  it("마지막 패킷 변조는 끝 해시로 잡고 그 번호를 가리킨다", async () => {
    const bytes = await sessionOf(10);
    bytes[9 * 64 + 14]! ^= 0x01;
    expect(await verifyBinaryHashChain(bytes)).toMatchObject({ isValid: false, brokenSequenceId: 9, reason: "FINAL_HASH_MISMATCH" });
  });

  it("다른 단말·시작 시각의 제네시스와 다르면 거부", async () => {
    const bytes = await sessionOf(5);
    const other = toHex(await computeGenesisHash("40000000-0000-0000-0000-000000000002", START));
    expect(await verifyBinaryHashChain(bytes, { expectedInitialHash: other })).toMatchObject({ isValid: false, reason: "GENESIS_MISMATCH" });
  });

  it("길이가 64의 배수+32 가 아니면 형식 오류", async () => {
    const bytes = await sessionOf(5);
    expect(await verifyBinaryHashChain(bytes.subarray(0, bytes.length - 1))).toMatchObject({ isValid: false, reason: "MALFORMED_LENGTH" });
  });
});

describe("적응형 샘플링", () => {
  it("페달 변화 2% 미만이면 1Hz, 밟거나 2% 이상 변하면 20Hz", () => {
    const sampler = new AdaptiveSampler();
    let idle = 0;
    for (let t = 0; t < 10_000; t += 50) if (sampler.shouldRecord(t, 0.5, 0)) idle += 1;
    expect(idle).toBe(10); // 10초 → 10개(1Hz)
    expect(sampler.mode).toBe("IDLE");

    let active = 0;
    for (let t = 10_000; t < 20_000; t += 50) if (sampler.shouldRecord(t, 30, 0)) active += 1;
    expect(active).toBe(200); // 10초 → 200개(20Hz)
    expect(sampler.mode).toBe("ACTIVE");
  });
});

describe("트리거 감지", () => {
  const base: SensorSample = { timestampMs: 0, accelDistance: 0, accelPercent: 0, brakeDistance: 0, brakePercent: 0, latitudeE7: 0, longitudeE7: 0, speedDeciKmh: 0 };
  it("0.2초 안에 제동 80% 도달 → sudden_accel, 천천히 밟으면 아님", () => {
    const recent = [{ ...base, timestampMs: 850, brakePercent: 10 }];
    expect(detectTrigger(recent, { ...base, timestampMs: 1000, brakePercent: 85 })).toBe("sudden_accel");
    const slow = [{ ...base, timestampMs: 500, brakePercent: 10 }, { ...base, timestampMs: 900, brakePercent: 60 }];
    expect(detectTrigger(slow, { ...base, timestampMs: 1000, brakePercent: 85 })).toBeNull();
  });
  it("충격 3.0G 초과 → shock, 감속 8m/s² → sudden_accel", () => {
    expect(detectTrigger([], { ...base, impactG: 3.2 })).toBe("shock");
    expect(detectTrigger([], { ...base, impactG: 3.0 })).toBeNull();
    expect(detectTrigger([], { ...base, longitudinalMs2: -8.5 })).toBe("sudden_accel");
  });
});

describe("단말 단독 사고 기록(BLE 미연결 시뮬레이션)", () => {
  const drive: DriveSegment[] = [
    { durationMs: 20_000, accel: 0, brake: 0, speedKmh: 0 }, // 정차
    { durationMs: 40_000, accel: 0.4, brake: 0, speedKmh: 50 }, // 주행
    { durationMs: 500, accel: 0, brake: 0, speedKmh: 50 }, // 발 뗌
    { durationMs: 40_000, accel: 0, brake: 1, speedKmh: 0 }, // 급제동 이후
  ];

  it("급제동 → 직전 30초 + 이후 30초 = 1,200개 패킷, 50ms 간격 결락 없음, 체인 유효", async () => {
    const recorder = new EventRecorder(DEVICE);
    for (const sample of mockPedalHardwareStream(drive, START)) {
      recorder.ingest(sample);
      if (recorder.state === "FROZEN") break;
    }
    expect(recorder.state).toBe("FROZEN");
    const session = await recorder.freeze();
    expect(session.triggerType).toBe("sudden_accel");
    expect(session.recordCount).toBe(1200);
    expect(session.bytes.length).toBe(1200 * 64 + 32);
    expect(session.triggerAtMs - session.startTimeMs).toBe(30_000);
    expect(session.endTimeMs - session.triggerAtMs).toBe(29_950);

    for (let i = 1; i < 1200; i += 1) {
      const gap = decodePacketRecord(session.bytes, i * PACKET_SIZE).timestampMs - decodePacketRecord(session.bytes, (i - 1) * PACKET_SIZE).timestampMs;
      expect(gap).toBe(50);
    }
    const atTrigger = decodePacketRecord(session.bytes, 600 * PACKET_SIZE);
    expect(atTrigger.brakePercent).toBe(100);
    expect(decodePacketRecord(session.bytes, 599 * PACKET_SIZE).brakePercent).toBe(0);

    const genesis = toHex(await computeGenesisHash(DEVICE, session.startTimeMs));
    expect(await verifyBinaryHashChain(session.bytes, { expectedInitialHash: genesis })).toMatchObject({ isValid: true, totalRecords: 1200 });
  });

  it("수동 백업 버튼으로도 60초 세션을 만든다", async () => {
    const recorder = new EventRecorder(DEVICE);
    let count = 0;
    for (const sample of mockPedalHardwareStream([{ durationMs: 120_000, accel: 0.2, brake: 0, speedKmh: 30 }], START)) {
      recorder.ingest(sample);
      count += 1;
      if (count === 900) recorder.pressManualButton();
      if (recorder.state === "FROZEN") break;
    }
    const session = await recorder.freeze();
    expect(session.triggerType).toBe("manual");
    expect(session.recordCount).toBe(1200);
  });

  it("평시 정차 중에는 1Hz 로만 플래시 로그에 남긴다", () => {
    const recorder = new EventRecorder(DEVICE);
    for (const sample of mockPedalHardwareStream([{ durationMs: 10_000, accel: 0, brake: 0, speedKmh: 0 }], START)) recorder.ingest(sample);
    expect(recorder.routineRecorded).toBe(10);
    expect(recorder.state).toBe("IDLE");
  });

  it("50Hz 설정이면 60초 3,000개", async () => {
    const recorder = new EventRecorder(DEVICE, 50);
    let count = 0;
    for (const sample of mockPedalHardwareStream([{ durationMs: 120_000, accel: 0.2, brake: 0, speedKmh: 30 }], START, 50)) {
      recorder.ingest(sample);
      count += 1;
      if (count === 2000) recorder.pressManualButton();
      if (recorder.state === "FROZEN") break;
    }
    expect((await recorder.freeze()).recordCount).toBe(3000);
  });
});
