import { describe, expect, it } from "vitest";

import {
  calculatePedalPercentage,
  formatMillimeters,
  isValidStroke,
  summarizeSamples,
} from "@/lib/telemetry/displacement-engine";

// 유휴 120.50mm, 완전 답입 80.50mm (가동 40mm)
const MIN = 8050;
const MAX = 12050;

describe("calculatePedalPercentage (역방향 ToF: 거리가 줄수록 답입률 증가)", () => {
  it("유휴 거리 0%, 완전 답입 거리 100%, 중간 50%", () => {
    expect(calculatePedalPercentage(MAX, MIN, MAX)).toBe(0);
    expect(calculatePedalPercentage(MIN, MIN, MAX)).toBe(100);
    expect(calculatePedalPercentage(10050, MIN, MAX)).toBe(50);
  });

  it("거리가 줄어들수록 단조 증가한다", () => {
    let previous = -1;
    for (let raw = MAX; raw >= MIN; raw -= 100) {
      const percent = calculatePedalPercentage(raw, MIN, MAX);
      expect(percent).toBeGreaterThanOrEqual(previous);
      previous = percent;
    }
  });

  it("2% 이하는 데드존으로 0%, 2% 초과부터 반영", () => {
    expect(calculatePedalPercentage(MAX - 80, MIN, MAX)).toBe(0); // 정확히 2%
    expect(calculatePedalPercentage(MAX - 120, MIN, MAX)).toBe(3); // 3%
  });

  it("범위 밖(오버슈트·언더슈트)은 0~100으로 자른다", () => {
    expect(calculatePedalPercentage(MAX + 500, MIN, MAX)).toBe(0);
    expect(calculatePedalPercentage(MIN - 500, MIN, MAX)).toBe(100);
  });

  it("가동 범위 5mm 미만이면 거부한다", () => {
    expect(isValidStroke(10000, 10499)).toBe(false);
    expect(isValidStroke(10000, 10500)).toBe(true);
    expect(() => calculatePedalPercentage(10200, 10000, 10499)).toThrow(RangeError);
  });

  it("10mm 변위가 0.01mm 단위로 손실 없이 환산된다", () => {
    // 10.00mm = 1000 단위 → 가동 40mm 의 25%
    expect(calculatePedalPercentage(MAX - 1000, MIN, MAX)).toBe(25);
    expect(formatMillimeters(MAX - 1000)).toBe("110.50");
    expect(formatMillimeters(12345)).toBe("123.45");
  });
});

describe("summarizeSamples (3초 구간 대표값)", () => {
  it("안정된 구간은 평균을 내고 stable", () => {
    const samples = Array.from({ length: 60 }, (_, i) => 12050 + ((i % 5) - 2));
    expect(summarizeSamples(samples)).toMatchObject({ average: 12050, stable: true, kept: 60, total: 60 });
  });

  it("튀는 반사 노이즈는 버리고 평균한다", () => {
    const samples = [...Array.from({ length: 57 }, () => 8050), 20000, 100, 15000];
    const summary = summarizeSamples(samples);
    expect(summary.average).toBe(8050);
    expect(summary.kept).toBe(57);
    expect(summary.stable).toBe(true);
  });

  it("측정 중 페달이 움직이면 unstable", () => {
    const samples = Array.from({ length: 60 }, (_, i) => 12050 - i * 50);
    expect(summarizeSamples(samples).stable).toBe(false);
  });

  it("샘플이 없으면 unstable", () => {
    expect(summarizeSamples([]).stable).toBe(false);
  });
});
