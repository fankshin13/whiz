/** 적응형 샘플링: 페달이 거의 그대로면 1Hz, 2% 이상 밟거나 2% 이상 변하면 20Hz. */

export const IDLE_INTERVAL_MS = 1000; // 1Hz
export const ACTIVE_INTERVAL_MS = 50; // 20Hz
export const ACTIVE_THRESHOLD_PERCENT = 2;

export type SamplingMode = "IDLE" | "ACTIVE";

export class AdaptiveSampler {
  private lastAt = -Infinity;
  private last = { accel: 0, brake: 0 };
  mode: SamplingMode = "IDLE";

  /** 이번 측정값을 기록 대상으로 삼을지 판단한다. forceActive 는 사고 트리거 이후 등 강제 20Hz. */
  shouldRecord(nowMs: number, accelPercent: number, brakePercent: number, forceActive = false): boolean {
    const changed =
      Math.abs(accelPercent - this.last.accel) >= ACTIVE_THRESHOLD_PERCENT ||
      Math.abs(brakePercent - this.last.brake) >= ACTIVE_THRESHOLD_PERCENT;
    const pressed = accelPercent >= ACTIVE_THRESHOLD_PERCENT || brakePercent >= ACTIVE_THRESHOLD_PERCENT;
    this.mode = forceActive || changed || pressed ? "ACTIVE" : "IDLE";

    const interval = this.mode === "ACTIVE" ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
    if (nowMs - this.lastAt < interval) return false;
    this.lastAt = nowMs;
    this.last = { accel: accelPercent, brake: brakePercent };
    return true;
  }
}
