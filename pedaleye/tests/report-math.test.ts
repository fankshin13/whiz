import { describe, expect, it } from "vitest";

import { computeStatistics, downsampleMinMax, dualPressRanges, selectLedger, triggerIndex } from "@/lib/forensics/report-math";
import type { DecodedPacket } from "@/types/forensics";

const START = Date.UTC(2026, 10, 15, 0, 0, 0);

function packets(count: number, at: (i: number) => Partial<DecodedPacket> = () => ({})): DecodedPacket[] {
  return Array.from({ length: count }, (_, i) => ({
    sequenceId: i,
    timestampUtc: START + i * 50,
    timestampIso: "",
    accelDistanceMm: 120.5,
    accelPercent: 0,
    brakeDistanceMm: 130,
    brakePercent: 0,
    bothPedalFlag: false,
    latitude: 37.5665,
    longitude: 126.978,
    speedKmh: 50,
    prevRecordHash: "",
    calculatedHash: "",
    ...at(i),
  }));
}

// 급제동 시나리오: 0~589 가속 40%, 580~599 양발, 600~ 제동 100%·감속
const crash = packets(1200, (i) => ({
  accelPercent: i < 600 ? 40 : 0,
  brakePercent: i >= 580 && i < 600 ? 20 : i >= 600 ? 100 : 0,
  bothPedalFlag: i >= 580 && i < 600,
  speedKmh: i < 600 ? 50 : Math.max(0, 50 - (i - 600) * 0.5),
}));

describe("보고서 통계", () => {
  it("최대 답력·양발 지속 시간·트리거 시점 속도·총 기록 시간", () => {
    expect(triggerIndex(crash)).toBe(600);
    expect(computeStatistics(crash)).toEqual({
      maxAccelPercent: 40,
      maxBrakePercent: 100,
      dualPressDurationSeconds: 1, // 20패킷 × 50ms
      speedAtTriggerKmh: 50,
      maxSpeedKmh: 50,
      totalDurationSeconds: 60,
    });
  });

  it("양발 구간은 전체 패킷 기준 연속 구간으로 묶는다", () => {
    expect(dualPressRanges(crash)).toEqual([{ startMs: START + 580 * 50, endMs: START + 599 * 50 }]);
  });
});

describe("인쇄용 다운샘플링", () => {
  it("600점 이하로 줄이되 처음·끝과 1패킷짜리 피크를 보존한다", () => {
    const spiky = packets(3000, (i) => ({ brakePercent: i === 1777 ? 100 : 0, accelPercent: i === 2222 ? 90 : 10 }));
    const sample = downsampleMinMax(spiky);
    expect(sample.length).toBeLessThanOrEqual(600);
    expect(sample[0]?.sequenceId).toBe(0);
    expect(sample[sample.length - 1]?.sequenceId).toBe(2999);
    expect(sample.some((p) => p.sequenceId === 1777)).toBe(true);
    expect(sample.some((p) => p.sequenceId === 2222)).toBe(true);
    expect(sample.map((p) => p.sequenceId)).toEqual([...sample.map((p) => p.sequenceId)].sort((a, b) => a - b));
  });

  it("작은 세션은 그대로 둔다", () => {
    expect(downsampleMinMax(packets(100))).toHaveLength(100);
  });
});

describe("감사표 선별", () => {
  it("시작 3, 트리거 전후 5, 끝 3 = 11개", () => {
    expect(selectLedger(crash).map((p) => p.sequenceId)).toEqual([0, 1, 2, 598, 599, 600, 601, 602, 1197, 1198, 1199]);
  });
});
