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
// 서울시청 인근(37.5665, 126.9780)에서 북쪽으로 이동
const START_LAT_E7 = 375665000;
const START_LON_E7 = 1269780000;

export function* mockPedalHardwareStream(
  segments: readonly DriveSegment[],
  startMs: number,
  rateHz = 20,
): Generator<SensorSample> {
  const step = 1000 / rateHz;
  let t = startMs;
  let latitude = START_LAT_E7;
  for (const segment of segments) {
    const end = t + segment.durationMs;
    for (; t < end; t += step) {
      const accelDistance = Math.round(A.idle - segment.accel * (A.idle - A.full));
      const brakeDistance = Math.round(B.idle - segment.brake * (B.idle - B.full));
      latitude += Math.round((segment.speedKmh / 3.6) * (step / 1000) * 90); // 약 1m ≈ 90 (1e-7°)
      yield {
        timestampMs: Math.round(t),
        accelDistance,
        accelPercent: calculatePedalPercentage(accelDistance, A.full, A.idle),
        brakeDistance,
        brakePercent: calculatePedalPercentage(brakeDistance, B.full, B.idle),
        latitudeE7: latitude,
        longitudeE7: START_LON_E7,
        speedDeciKmh: Math.round(segment.speedKmh * 10),
        impactG: segment.impactG,
      };
    }
  }
}
