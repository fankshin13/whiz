"use client";

import { useEffect, useState } from "react";

import { buildTelemetryFrame } from "@/lib/telemetry/pedal-calculator";
import { calculatePedalPercentage } from "@/lib/telemetry/displacement-engine";
import type { PedalSensorSource } from "@/lib/telemetry/sensor-source";
import type { TelemetryFrame } from "@/lib/telemetry/types";

export type TelemetryStatus = "paused" | "connecting" | "live" | "delayed" | "lost";

export interface PedalCalibration {
  accelCalibMin: number;
  accelCalibMax: number;
  brakeCalibMin: number;
  brakeCalibMax: number;
}

export const DELAYED_AFTER_MS = 150; // 20Hz 3프레임 누락
export const LOST_AFTER_MS = 3000;

/**
 * 센서 소스를 구독해 20Hz 텔레메트리 프레임을 만든다.
 * 워치독이 마지막 수신 후 150ms 넘으면 '신호 지연', 3초 넘으면 '신호 끊김'.
 * connection 값이 바뀌면 다시 구독한다(재연결).
 */
export function usePedalTelemetry({
  createSource,
  calibration,
  active,
  connection,
}: {
  /** 센서 소스 생성 함수(구독 시점에 호출). 웹은 시뮬레이터, 앱은 BLE. */
  createSource: () => PedalSensorSource;
  calibration: PedalCalibration;
  active: boolean;
  connection: number;
}): { frame: TelemetryFrame | null; status: TelemetryStatus } {
  const [frame, setFrame] = useState<TelemetryFrame | null>(null);
  const [status, setStatus] = useState<Exclude<TelemetryStatus, "paused">>("connecting");

  useEffect(() => {
    if (!active) return;
    let sequence = 0;
    let lastAt = 0;

    const unsubscribe = createSource().subscribe((reading) => {
      lastAt = Date.now();
      sequence += 1;
      setFrame(
        buildTelemetryFrame(
          sequence,
          reading.timestamp,
          calculatePedalPercentage(reading.accelDistance, calibration.accelCalibMin, calibration.accelCalibMax),
          calculatePedalPercentage(reading.brakeDistance, calibration.brakeCalibMin, calibration.brakeCalibMax),
        ),
      );
      setStatus("live");
    });

    const startedAt = Date.now();
    const watchdog = setInterval(() => {
      const gap = Date.now() - (lastAt || startedAt);
      if (gap > LOST_AFTER_MS) setStatus("lost");
      else if (!lastAt) setStatus("connecting");
      else if (gap > DELAYED_AFTER_MS) setStatus("delayed");
    }, 50);

    return () => {
      unsubscribe();
      clearInterval(watchdog);
    };
  }, [createSource, calibration, active, connection]);

  return { frame, status: active ? status : "paused" };
}
