/**
 * 4단계 캘리브레이션 마법사 진행 규칙(순수 상태 머신). 웹·모바일 앱이 같은 규칙을 쓰도록 화면과 분리한다.
 */
import type { CalibrationPayload } from "@/types/calibration";
import { MIN_STROKE, type SampleSummary } from "@/lib/telemetry/displacement-engine";

export type Pedal = "accel" | "brake";
export type CaptureKey = "accelIdle" | "accelFull" | "brakeIdle" | "brakeFull";

export interface WizardStep {
  key: CaptureKey;
  pedal: Pedal;
  title: string;
  instruction: string;
}

export const CAPTURE_SECONDS = 3;

export const WIZARD_STEPS: readonly WizardStep[] = [
  { key: "accelIdle", pedal: "accel", title: "가속 페달 영점(0%)", instruction: "가속 페달에서 발을 완전히 떼고 3초간 기다려 주세요." },
  { key: "accelFull", pedal: "accel", title: "가속 페달 최대(100%)", instruction: "가속 페달을 바닥까지 끝까지 힘껏 밟은 상태를 3초간 유지해 주세요." },
  { key: "brakeIdle", pedal: "brake", title: "제동 페달 영점(0%)", instruction: "브레이크 페달에서 발을 완전히 떼고 3초간 기다려 주세요." },
  { key: "brakeFull", pedal: "brake", title: "제동 페달 최대(100%)", instruction: "브레이크 페달을 온 힘을 다해 끝까지 밟은 상태를 3초간 유지해 주세요." },
];

export interface WizardState {
  stepIndex: number; // 0~3: 측정 단계, 4: 반응 테스트·저장 단계
  captured: Partial<Record<CaptureKey, number>>;
  error: string | null;
}

export type WizardAction = { type: "captured"; summary: SampleSummary } | { type: "restart" };

export const initialWizardState: WizardState = { stepIndex: 0, captured: {}, error: null };

const PEDAL_NAME: Record<Pedal, string> = { accel: "가속", brake: "제동" };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  if (action.type === "restart") return initialWizardState;

  const step = WIZARD_STEPS[state.stepIndex];
  if (!step) return state;

  if (!action.summary.stable) {
    return { ...state, error: "측정값이 흔들렸습니다. 페달을 같은 자세로 유지한 채 다시 측정해 주세요." };
  }

  if (step.key === "accelFull" || step.key === "brakeFull") {
    const idle = state.captured[step.pedal === "accel" ? "accelIdle" : "brakeIdle"] ?? 0;
    if (idle - action.summary.average < MIN_STROKE) {
      return {
        ...state,
        error: `${PEDAL_NAME[step.pedal]} 페달 가동 범위가 너무 작습니다(최소 5mm 이상 필요). 끝까지 밟은 뒤 다시 측정해 주세요.`,
      };
    }
  }

  return {
    stepIndex: state.stepIndex + 1,
    captured: { ...state.captured, [step.key]: action.summary.average },
    error: null,
  };
}

export function isWizardComplete(state: WizardState): boolean {
  return state.stepIndex >= WIZARD_STEPS.length;
}

/** 측정 결과 → 저장 계약. 유휴(먼 거리)가 max, 완전 답입(가까운 거리)이 min. */
export function toCalibrationPayload(deviceId: string, state: WizardState): CalibrationPayload | null {
  const { accelIdle, accelFull, brakeIdle, brakeFull } = state.captured;
  if (accelIdle === undefined || accelFull === undefined || brakeIdle === undefined || brakeFull === undefined) {
    return null;
  }
  return {
    deviceId,
    accelCalibMin: accelFull,
    accelCalibMax: accelIdle,
    brakeCalibMin: brakeFull,
    brakeCalibMax: brakeIdle,
  };
}
