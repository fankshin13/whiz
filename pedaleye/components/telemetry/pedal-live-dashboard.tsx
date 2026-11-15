"use client";

import { Gauge, Pause, Play, RefreshCw, Volume2, VolumeX, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PedalLiveGauge } from "@/components/calibration/pedal-live-gauge";
import { SensorSimulator } from "@/components/calibration/sensor-simulator";
import { usePedalTelemetry, type PedalCalibration, type TelemetryStatus } from "@/hooks/use-pedal-telemetry";
import type { Pedal } from "@/lib/calibration/wizard";
import { createSimulatedSensorSource, type PedalSensorSource } from "@/lib/telemetry/sensor-source";

import { DualWarningBanner } from "./dual-warning-banner";
import { LedLevelBar } from "./led-level-bar";

const STATUS_TEXT: Record<TelemetryStatus, string> = {
  paused: "일시정지",
  connecting: "연결 중",
  live: "수신 중 (20Hz)",
  delayed: "신호 지연",
  lost: "연결 끊김",
};

/** 운전자 대시보드의 실시간 페달 모니터링. 센서는 지금 시뮬레이터이며 모바일 앱에서 BLE 소스로 바뀐다. */
export function PedalLiveDashboard({ calibration, plateNumber }: { calibration: PedalCalibration; plateNumber: string }) {
  const [active, setActive] = useState(false);
  const [connection, setConnection] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [press, setPress] = useState<Record<Pedal, number>>({ accel: 0, brake: 0 });
  const [signalCut, setSignalCut] = useState(false);
  const pressRef = useRef(press);
  const signalCutRef = useRef(signalCut);
  const audioRef = useRef<AudioContext | null>(null);

  // 모바일 앱에서는 이 자리를 BLE 센서 소스로 바꾼다. '신호 끊기'는 단말 단절을 흉내 낸다.
  const createSource = useCallback((): PedalSensorSource => {
    const simulator = createSimulatedSensorSource(() => ({
      accel: pressRef.current.accel / 100,
      brake: pressRef.current.brake / 100,
    }));
    return {
      subscribe: (onReading) =>
        simulator.subscribe((reading) => {
          if (!signalCutRef.current) onReading(reading);
        }),
    };
  }, []);

  const { frame, status } = usePedalTelemetry({ createSource, calibration, active, connection });
  const dual = active && frame?.mode === "DUAL_WARNING" && status === "live";

  // 양발 동시 조작 동안 단속 경고음(0.4초 간격)
  useEffect(() => {
    if (!dual || !soundOn) return;
    const beep = () => {
      const context = audioRef.current;
      if (!context) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.value = 0.15;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
    };
    beep();
    const timer = setInterval(beep, 400);
    return () => clearInterval(timer);
  }, [dual, soundOn]);

  const toggleActive = () => {
    if (!active && !audioRef.current && typeof AudioContext !== "undefined") {
      audioRef.current = new AudioContext(); // 사용자 동작 안에서 만들어야 소리가 난다
    }
    setActive((value) => !value);
  };

  const changePress = (pedal: Pedal, value: number) => {
    const next = { ...pressRef.current, [pedal]: value };
    pressRef.current = next;
    setPress(next);
  };

  const toggleSignal = (cut: boolean) => {
    signalCutRef.current = cut;
    setSignalCut(cut);
  };

  return (
    <section aria-labelledby="live-heading" className="card grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="live-heading" className="m-0 flex items-center gap-2 text-h2 font-semibold">
            <Gauge aria-hidden="true" size={20} />
            실시간 페달 모니터링
          </h2>
          <p className="m-0 text-text-muted">
            {plateNumber} ·{" "}
            <span data-telemetry-status={status} className="font-semibold text-text-main">
              {STATUS_TEXT[status]}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={toggleActive} aria-pressed={active}>
            {active ? <Pause aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}
            {active ? "모니터링 일시정지" : "실시간 페달 모니터링 시작"}
          </button>
          <button
            type="button"
            className="btn btn-secondary px-0"
            onClick={() => setSoundOn((value) => !value)}
            aria-pressed={soundOn}
            aria-label={soundOn ? "경고음 끄기" : "경고음 켜기"}
          >
            {soundOn ? <Volume2 aria-hidden="true" size={20} /> : <VolumeX aria-hidden="true" size={20} />}
          </button>
        </div>
      </div>

      {status === "connecting" ? (
        <p className="m-0 flex items-center gap-2 text-text-muted" role="status">
          <span className="spinner" aria-hidden="true" />
          단말기와 실시간 통신 채널을 동기화하고 있습니다...
        </p>
      ) : null}

      {status === "lost" ? (
        <div className="alert grid gap-3" role="alert">
          <p className="m-0">
            단말기로부터 실시간 신호가 수신되지 않습니다. 퓨즈박스 전원 및 케이블 연결 상태를 확인해주세요.
          </p>
          <button type="button" className="btn justify-self-start" onClick={() => setConnection((value) => value + 1)}>
            <RefreshCw aria-hidden="true" size={18} />
            장치 재연결
          </button>
        </div>
      ) : null}

      {dual ? <DualWarningBanner /> : null}

      <div className={`grid gap-4 ${active ? "" : "opacity-60"}`} aria-hidden={!active}>
        <LedLevelBar frame={active ? frame : null} />
        <div className="grid gap-4 sm:grid-cols-2">
          <PedalLiveGauge pedal="accel" percent={active ? frame?.accelPercent ?? 0 : 0} level={active ? frame?.accelLevel ?? 0 : 0} />
          <PedalLiveGauge pedal="brake" percent={active ? frame?.brakePercent ?? 0 : 0} level={active ? frame?.brakeLevel ?? 0 : 0} />
        </div>
        <span className="sr-only" data-frame-seq={frame?.sequenceId ?? 0} />
      </div>

      <details className="grid gap-3">
        <summary className="flex min-h-(--size-touch) cursor-pointer items-center gap-2 font-semibold">
          <Zap aria-hidden="true" size={18} />
          센서 시뮬레이터(테스트용)
        </summary>
        <div className="mt-3 grid gap-3">
          <SensorSimulator values={press} onChange={changePress} />
          <label className="flex min-h-(--size-touch) items-center gap-3 font-semibold">
            <input
              type="checkbox"
              className="size-5 accent-brake"
              checked={signalCut}
              onChange={(event) => toggleSignal(event.currentTarget.checked)}
            />
            단말 신호 끊기(연결 단절 시험)
          </label>
        </div>
      </details>
    </section>
  );
}
