"use client";

import { RotateCcw, Save, Timer } from "lucide-react";
import { useActionState, useEffect, useReducer, useRef, useState } from "react";

import { updateDeviceCalibrationAction, type CalibrationActionState } from "@/lib/calibration/actions";
import {
  CAPTURE_SECONDS,
  WIZARD_STEPS,
  initialWizardState,
  isWizardComplete,
  toCalibrationPayload,
  wizardReducer,
  type Pedal,
} from "@/lib/calibration/wizard";
import { calculatePedalPercentage, formatMillimeters, summarizeSamples } from "@/lib/telemetry/displacement-engine";
import { createSimulatedSensorSource } from "@/lib/telemetry/sensor-source";
import type { DeviceCalibrationData, DualPedalReading } from "@/types/calibration";

import { PedalLiveGauge } from "./pedal-live-gauge";
import { SensorSimulator } from "./sensor-simulator";

const initialSaveState: CalibrationActionState = { error: null };

export function CalibrationWizard({ device }: { device: DeviceCalibrationData }) {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const [press, setPress] = useState<Record<Pedal, number>>({ accel: 0, brake: 0 });
  const pressRef = useRef(press);
  const [reading, setReading] = useState<DualPedalReading | null>(null);
  const [collecting, setCollecting] = useState<{ startedAt: number; elapsed: number } | null>(null);
  const samplesRef = useRef<number[]>([]);


  const step = WIZARD_STEPS[state.stepIndex];
  // 수집 중인 페달(없으면 null). 구독 콜백이 최신 값을 읽도록 ref 로 둔다.
  const collectingPedalRef = useRef<Pedal | null>(null);

  useEffect(() => {
    // 모바일 앱에서는 이 자리를 BLE 센서 소스로 바꾼다
    const source = createSimulatedSensorSource(() => ({
      accel: pressRef.current.accel / 100,
      brake: pressRef.current.brake / 100,
    }));
    return source.subscribe((next) => {
      setReading(next);
      const pedal = collectingPedalRef.current;
      if (pedal) samplesRef.current.push(pedal === "accel" ? next.accelDistance : next.brakeDistance);
    });
  }, []);

  useEffect(() => {
    if (!collecting) return;
    const timer = setInterval(() => {
      const elapsed = (Date.now() - collecting.startedAt) / 1000;
      if (elapsed >= CAPTURE_SECONDS) {
        clearInterval(timer);
        collectingPedalRef.current = null;
        setCollecting(null);
        dispatch({ type: "captured", summary: summarizeSamples(samplesRef.current) });
      } else {
        setCollecting({ startedAt: collecting.startedAt, elapsed });
      }
    }, 100);
    return () => clearInterval(timer);
  }, [collecting]);

  const startCapture = () => {
    if (!step) return;
    samplesRef.current = [];
    collectingPedalRef.current = step.pedal;
    setCollecting({ startedAt: Date.now(), elapsed: 0 });
  };

  const changePress = (pedal: Pedal, value: number) => {
    const next = { ...pressRef.current, [pedal]: value };
    pressRef.current = next;
    setPress(next);
  };

  const complete = isWizardComplete(state);
  const payload = toCalibrationPayload(device.deviceId, state);
  const currentDistance = reading && step ? (step.pedal === "accel" ? reading.accelDistance : reading.brakeDistance) : null;

  return (
    <div className="grid gap-6">
      <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-4" aria-label="보정 단계">
        {WIZARD_STEPS.map((item, index) => {
          const status = index < state.stepIndex ? "완료" : index === state.stepIndex ? "진행 중" : "대기";
          return (
            <li
              key={item.key}
              aria-current={index === state.stepIndex ? "step" : undefined}
              className={`grid gap-0.5 rounded-md border px-3 py-2 ${
                index === state.stepIndex ? "border-primary-action bg-bg-base" : "border-border bg-bg-panel"
              }`}
            >
              <span className="text-caption font-medium text-text-muted">
                {index + 1}단계 · {status}
              </span>
              <span className="font-semibold">{item.title}</span>
              {state.captured[item.key] !== undefined ? (
                <span className="text-caption tabular-nums text-text-muted">
                  {formatMillimeters(state.captured[item.key] ?? 0)}mm
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {!complete && step ? (
          <section aria-labelledby="step-heading" className="card grid content-start gap-4">
            <h2 id="step-heading" className="m-0 text-h2 font-semibold">
              {state.stepIndex + 1}단계: {step.title}
            </h2>
            <p className="m-0">{step.instruction}</p>
            <p className="m-0 text-text-muted">
              현재 센서 거리{" "}
              <strong className="text-text-main tabular-nums">
                {currentDistance === null ? "측정 대기" : `${formatMillimeters(currentDistance)}mm`}
              </strong>
            </p>

            <div aria-live="polite">
              {state.error ? (
                <p className="alert m-0" role="alert">
                  {state.error}
                </p>
              ) : null}
            </div>

            {collecting ? (
              <div className="grid gap-2">
                <div
                  role="progressbar"
                  aria-label="샘플 수집 진행률"
                  aria-valuemin={0}
                  aria-valuemax={CAPTURE_SECONDS}
                  aria-valuenow={Math.min(CAPTURE_SECONDS, Math.round(collecting.elapsed * 10) / 10)}
                  className="h-3 overflow-hidden rounded-md bg-border"
                >
                  <div
                    className="h-full bg-primary-action"
                    style={{ width: `${Math.min(100, (collecting.elapsed / CAPTURE_SECONDS) * 100)}%` }}
                  />
                </div>
                <span className="text-text-muted" aria-live="polite">
                  측정 중... 자세를 유지해 주세요
                </span>
              </div>
            ) : (
              <button type="button" className="btn justify-self-start" onClick={startCapture}>
                <Timer aria-hidden="true" size={18} />
                {state.error ? "다시 측정" : `샘플 수집 시작 (${CAPTURE_SECONDS}초)`}
              </button>
            )}
          </section>
        ) : null}

        {complete && payload ? (
          <section aria-labelledby="verify-heading" className="card grid content-start gap-4">
            <div className="grid gap-1">
              <h2 id="verify-heading" className="m-0 text-h2 font-semibold">
                반응 테스트
              </h2>
              <p className="m-0 text-text-muted">
                페달을 밟아 0%에서 100%까지 숫자가 자연스럽게 바뀌는지 확인한 뒤 저장해 주세요.
              </p>
            </div>
            <PedalLiveGauge
              pedal="accel"
              percent={reading ? calculatePedalPercentage(reading.accelDistance, payload.accelCalibMin, payload.accelCalibMax) : 0}
            />
            <PedalLiveGauge
              pedal="brake"
              percent={reading ? calculatePedalPercentage(reading.brakeDistance, payload.brakeCalibMin, payload.brakeCalibMax) : 0}
            />
            <dl className="m-0 grid grid-cols-2 gap-2 text-caption">
              <div>
                <dt className="text-text-muted">가속 0% / 100%</dt>
                <dd className="m-0 tabular-nums">
                  {formatMillimeters(payload.accelCalibMax)} / {formatMillimeters(payload.accelCalibMin)}mm
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">제동 0% / 100%</dt>
                <dd className="m-0 tabular-nums">
                  {formatMillimeters(payload.brakeCalibMax)} / {formatMillimeters(payload.brakeCalibMin)}mm
                </dd>
              </div>
            </dl>
            <SaveCalibrationForm payload={payload} onRestart={() => dispatch({ type: "restart" })} />
          </section>
        ) : null}

        <SensorSimulator values={press} onChange={changePress} />
      </div>
    </div>
  );
}

function SaveCalibrationForm({
  payload,
  onRestart,
}: {
  payload: NonNullable<ReturnType<typeof toCalibrationPayload>>;
  onRestart: () => void;
}) {
  const [saveState, saveAction, saving] = useActionState(updateDeviceCalibrationAction, initialSaveState);

  return (
    <form action={saveAction} className="grid gap-3" aria-busy={saving}>
      <div aria-live="polite">
        {saveState.error ? (
          <p className="alert m-0" role="alert">
            보정값 저장 중 오류가 발생했습니다: {saveState.error}. 다시 시도해 주세요.
          </p>
        ) : null}
      </div>
      {Object.entries(payload).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? <span className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" size={18} />}
          {saving ? "저장 중..." : saveState.error ? "다시 시도" : "설정값 단말에 저장"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onRestart} disabled={saving}>
          <RotateCcw aria-hidden="true" size={18} />
          처음부터 다시
        </button>
      </div>
    </form>
  );
}
