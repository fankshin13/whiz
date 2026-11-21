/**
 * 실제 단말 없이 주행을 흉내 내는 가상 센서 스트림(가상 시계, 즉시 생성).
 * 스마트폰·BLE 와 무관하게 기록기에 바로 공급해 '단독 동작'을 시험한다.
 */
import { calculatePedalPercentage } from "@/lib/telemetry/displacement-engine";
import type { SensorSample } from "@/lib/telemetry/event-buffer-freezer";
import { SIMULATED_GEOMETRY } from "@/lib/telemetry/sensor-source";

export interface DriveSegment {
  durationMs: number;
  accel: number; // 밟은 정도 0~1
  brake: number;
  speedKmh: number;
  impactG?: number;
}

const { accel: A, brake: B } = SIMULATED_GEOMETRY;

export function* mockPedalHardwareStream(
  segments: readonly DriveSegment[],
  startMs: number,
  rateHz = 20,
): Generator<SensorSample> {
  const step = 1000 / rateHz;
  let t = startMs;
  for (const segment of segments) {
    const end = t + segment.durationMs;
    for (; t < end; t += step) {
      const accelDistance = Math.round(A.idle - segment.accel * (A.idle - A.full));
      const brakeDistance = Math.round(B.idle - segment.brake * (B.idle - B.full));
      yield {
        timestampMs: Math.round(t),
        accelDistance,
        accelPercent: calculatePedalPercentage(accelDistance, A.full, A.idle),
        brakeDistance,
        brakePercent: calculatePedalPercentage(brakeDistance, B.full, B.idle),
        // 위치정보 미수집(규격 v1.1): GPS 위도·경도·속도는 항상 0
        latitudeE7: 0,
        longitudeE7: 0,
        speedDeciKmh: 0,
        impactG: segment.impactG,
      };
    }
  }
}
