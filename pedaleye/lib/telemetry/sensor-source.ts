/**
 * 페달 센서 입력 인터페이스. 지금은 웹 콘솔용 시뮬레이터만 있고,
 * 모바일 앱에서는 같은 모양의 BLE 구현으로 바꿔 끼운다.
 */
import type { DualPedalReading } from "@/types/calibration";

export interface PedalSensorSource {
  /** 측정값을 받기 시작한다. 반환 함수를 부르면 멈춘다. */
  subscribe(onReading: (reading: DualPedalReading) => void): () => void;
}

export const SIMULATED_SAMPLE_HZ = 20;

/** 시뮬레이터 차량의 물리 특성(0.01mm). 실제 장착 거리와 비슷한 값. */
export const SIMULATED_GEOMETRY = {
  accel: { idle: 12050, full: 8050 },
  brake: { idle: 13000, full: 9500 },
} as const;

const NOISE = 5; // ±0.05mm 센서 잡음

/** 페달 밟은 정도(0~1)를 읽어 20Hz 로 거리값을 내보내는 시뮬레이터. */
export function createSimulatedSensorSource(getPressRatio: () => { accel: number; brake: number }): PedalSensorSource {
  const toDistance = (pedal: "accel" | "brake", ratio: number) => {
    const { idle, full } = SIMULATED_GEOMETRY[pedal];
    const noise = Math.round((Math.random() * 2 - 1) * NOISE);
    return Math.round(idle - ratio * (idle - full)) + noise;
  };

  return {
    subscribe(onReading) {
      const timer = setInterval(() => {
        const ratio = getPressRatio();
        onReading({
          accelDistance: toDistance("accel", ratio.accel),
          brakeDistance: toDistance("brake", ratio.brake),
          timestamp: Date.now(),
        });
      }, 1000 / SIMULATED_SAMPLE_HZ);
      return () => clearInterval(timer);
    },
  };
}
