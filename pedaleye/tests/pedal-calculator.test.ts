import { describe, expect, it } from "vitest";

import {
  buildTelemetryFrame,
  calculatePedalLevel,
  decodeLedSerialFrame,
  determineOperationMode,
  encodeLedSerialFrame,
} from "@/lib/telemetry/pedal-calculator";

describe("calculatePedalLevel (5단계)", () => {
  it.each([
    [0, 0],
    [0.1, 1],
    [20, 1],
    [20.1, 2],
    [21, 2],
    [40, 2],
    [41, 3],
    [60, 3],
    [61, 4],
    [80, 4],
    [81, 5],
    [100, 5],
    [-3, 0],
  ])("%s%% → %s단계", (percent, level) => {
    expect(calculatePedalLevel(percent)).toBe(level);
  });
});

describe("determineOperationMode", () => {
  it("둘 다 5% 초과면 양발 동시 조작 경고", () => {
    expect(determineOperationMode(10, 20)).toEqual({ mode: "DUAL_WARNING", isDualPressed: true });
    expect(determineOperationMode(6, 6)).toEqual({ mode: "DUAL_WARNING", isDualPressed: true });
  });

  it("한쪽이 5% 이하면 단일 조작으로 본다(임계치 정확히 5% 포함)", () => {
    expect(determineOperationMode(5, 50)).toEqual({ mode: "BRAKE", isDualPressed: false });
    expect(determineOperationMode(85, 5)).toEqual({ mode: "ACCEL", isDualPressed: false });
  });

  it("가속만·제동만·둘 다 0", () => {
    expect(determineOperationMode(15, 0).mode).toBe("ACCEL");
    expect(determineOperationMode(0, 50).mode).toBe("BRAKE");
    expect(determineOperationMode(0, 0).mode).toBe("IDLE");
  });
});

describe("LED 직렬 프레임", () => {
  it("가속 85% → 청색 5칸, 적색 소등", () => {
    const bytes = encodeLedSerialFrame(buildTelemetryFrame(1, 0, 85, 0));
    expect([...bytes]).toEqual([0xaa, 0b11111, 0, 0xaa ^ 0b11111]);
  });

  it("가속에서 발을 떼고 제동 50% → 청색 즉시 소등, 적색 3칸", () => {
    const packet = decodeLedSerialFrame(encodeLedSerialFrame(buildTelemetryFrame(2, 0, 0, 50)));
    expect(packet).toMatchObject({ accelBits: 0, brakeBits: 0b00111, warningFlag: 0 });
  });

  it("양발 동시 조작 → 경고 플래그만, 단일 색 점등 해제", () => {
    const packet = decodeLedSerialFrame(encodeLedSerialFrame(buildTelemetryFrame(3, 0, 10, 20)));
    expect(packet).toMatchObject({ accelBits: 0, brakeBits: 0, warningFlag: 1 });
  });

  it("헤더·체크섬이 틀린 프레임은 거부한다", () => {
    const bytes = encodeLedSerialFrame(buildTelemetryFrame(4, 0, 15, 0));
    expect(decodeLedSerialFrame(Uint8Array.from([0x00, ...bytes.slice(1)]))).toBeNull();
    const tampered = Uint8Array.from(bytes);
    tampered[1] = 0b00011;
    expect(decodeLedSerialFrame(tampered)).toBeNull();
  });
});
