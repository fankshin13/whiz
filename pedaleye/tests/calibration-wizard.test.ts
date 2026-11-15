import { describe, expect, it } from "vitest";

import {
  WIZARD_STEPS,
  initialWizardState,
  isWizardComplete,
  toCalibrationPayload,
  wizardReducer,
  type WizardState,
} from "@/lib/calibration/wizard";
import type { SampleSummary } from "@/lib/telemetry/displacement-engine";

const capture = (average: number, stable = true): { type: "captured"; summary: SampleSummary } => ({
  type: "captured",
  summary: { average, spread: 4, kept: 60, total: 60, stable },
});

function run(values: number[]): WizardState {
  return values.reduce((state, value) => wizardReducer(state, capture(value)), initialWizardState);
}

describe("캘리브레이션 마법사 진행 규칙", () => {
  it("가속 0% → 가속 100% → 제동 0% → 제동 100% 순서로 4단계", () => {
    expect(WIZARD_STEPS.map((step) => step.key)).toEqual(["accelIdle", "accelFull", "brakeIdle", "brakeFull"]);
  });

  it("4단계를 마치면 유휴=max, 완전 답입=min 으로 저장 계약을 만든다", () => {
    const state = run([12050, 8050, 13000, 9500]);
    expect(isWizardComplete(state)).toBe(true);
    expect(toCalibrationPayload("d1", state)).toEqual({
      deviceId: "d1",
      accelCalibMin: 8050,
      accelCalibMax: 12050,
      brakeCalibMin: 9500,
      brakeCalibMax: 13000,
    });
  });

  it("흔들린 측정은 단계를 넘기지 않고 재측정을 안내한다", () => {
    const state = wizardReducer(initialWizardState, capture(12050, false));
    expect(state.stepIndex).toBe(0);
    expect(state.error).toContain("다시 측정");
  });

  it("가동 범위 5mm 미만이면 해당 페달 이름으로 경고하고 머문다", () => {
    const afterIdle = run([12050]);
    const tooShallow = wizardReducer(afterIdle, capture(11700)); // 3.5mm
    expect(tooShallow.stepIndex).toBe(1);
    expect(tooShallow.error).toContain("가속 페달 가동 범위가 너무 작습니다");

    const brakeShallow = wizardReducer(run([12050, 8050, 13000]), capture(12800));
    expect(brakeShallow.error).toContain("제동 페달 가동 범위가 너무 작습니다");
  });

  it("미완료 상태에서는 저장 계약을 만들지 않고, restart 로 처음으로 돌아간다", () => {
    const partial = run([12050, 8050]);
    expect(toCalibrationPayload("d1", partial)).toBeNull();
    expect(wizardReducer(partial, { type: "restart" })).toEqual(initialWizardState);
  });
});
