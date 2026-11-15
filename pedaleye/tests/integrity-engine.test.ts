import { describe, expect, it } from "vitest";

import { parseAllPackets, toSeoulIso, verifyLogFileIntegrity } from "@/lib/forensics/integrity-engine";
import { buildChainedSession, computeGenesisHash, toHex } from "@/lib/telemetry/hash-chain-engine";

const DEVICE = "40000000-0000-0000-0000-000000000001";
const START = Date.UTC(2026, 10, 15, 0, 0, 0);

async function log(count: number) {
  return buildChainedSession(
    DEVICE,
    Array.from({ length: count }, (_, i) => ({
      sequenceId: i,
      timestampMs: START + i * 20,
      accelDistance: 10520,
      accelPercent: i % 101,
      brakeDistance: 13000,
      brakePercent: 0,
      bothPedal: i % 50 === 0,
      latitudeE7: 375665000,
      longitudeE7: 1269780000,
      speedDeciKmh: 655,
    })),
  );
}

describe("포렌식 검증기", () => {
  it("3,000개(50Hz 60초) 전수 검증이 1초 안에 끝난다", async () => {
    const bytes = await log(3000);
    const genesis = toHex(await computeGenesisHash(DEVICE, START));
    const result = await verifyLogFileIntegrity(bytes, genesis);
    expect(result).toMatchObject({ isValid: true, totalRecords: 3000, initialHash: genesis });
    expect(result.verificationDurationMs).toBeLessThan(1000);
  });

  it("오프셋 500 바이트 변조 → 해당 패킷 다음에서 불일치, 기대·실제 해시와 시각 제공", async () => {
    const bytes = await log(3000);
    bytes[500]! ^= 0x01; // 패킷 #7 (500 = 7×64 + 52, 해시 영역)
    const result = await verifyLogFileIntegrity(bytes);
    expect(result.isValid).toBe(false);
    expect(result.failureDetail).toMatchObject({ failedSequenceId: 7, timestampUtc: START + 7 * 20 });
    expect(result.failureDetail?.expectedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.failureDetail?.expectedHash).not.toBe(result.failureDetail?.actualHash);
  });

  it("데이터 영역 1바이트 변조 → 다음 패킷에서 '직전 패킷 해시가 맞지 않습니다'", async () => {
    const bytes = await log(100);
    bytes[40 * 64 + 14]! ^= 0x01;
    const result = await verifyLogFileIntegrity(bytes);
    expect(result.failureDetail).toMatchObject({ failedSequenceId: 41, reason: "직전 패킷 해시가 맞지 않습니다" });
  });

  it("레코드 배수가 아닌 파일은 형식 오류 문구", async () => {
    const bytes = await log(10);
    const result = await verifyLogFileIntegrity(bytes.subarray(0, 100));
    expect(result.isValid).toBe(false);
    expect(result.failureDetail?.reason).toBe("로그 파일 크기가 64바이트 레코드 배수가 아닙니다.");
  });

  it("패킷을 사람이 읽는 단위로 풀고 계산 해시가 다음 패킷의 직전 해시와 같다", async () => {
    const packets = await parseAllPackets(await log(3));
    expect(packets[0]).toMatchObject({
      sequenceId: 0,
      timestampIso: "2026-11-15T09:00:00.000+09:00",
      accelDistanceMm: 105.2,
      brakeDistanceMm: 130,
      bothPedalFlag: true,
      latitude: 37.5665,
      longitude: 126.978,
      speedKmh: 65.5,
    });
    expect(packets[1]?.prevRecordHash).toBe(packets[0]?.calculatedHash);
    expect(toSeoulIso(Date.UTC(2026, 0, 1, 15, 0, 0, 5))).toBe("2026-01-02T00:00:00.005+09:00");
  });
});
