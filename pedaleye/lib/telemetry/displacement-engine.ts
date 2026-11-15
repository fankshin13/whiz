/**
 * ToF 거리 → 페달 답입률(0~100%) 변환 엔진. 순수 함수만 두어 펌웨어·모바일 앱으로 그대로 옮길 수 있게 한다.
 *
 * 센서는 페달 뒤 격벽에 달려 있어 페달을 밟을수록 거리가 줄어든다.
 *   calibMax = 0% 유휴 시 거리(가장 멂), calibMin = 100% 완전 답입 시 거리(가장 가까움)
 *   percent = (calibMax − raw) / (calibMax − calibMin) × 100, 2% 이하 데드존 → 0, 0~100 으로 자름
 */

export const MIN_STROKE = 500; // 최소 유효 가동 거리 5.00mm
export const DEADZONE_PERCENT = 2;
export const STABILITY_TOLERANCE = 100; // 측정 구간 흔들림 허용치 1.00mm
const OUTLIER_MAD_FACTOR = 3;
const MIN_KEPT_RATIO = 0.8;

export function isValidStroke(calibMin: number, calibMax: number): boolean {
  return calibMax - calibMin >= MIN_STROKE;
}

/** 답입률(정수 %). 가동 범위가 5mm 미만이면 RangeError. */
export function calculatePedalPercentage(rawDistance: number, calibMin: number, calibMax: number): number {
  if (!isValidStroke(calibMin, calibMax)) {
    throw new RangeError(`가동 범위가 ${MIN_STROKE / 100}mm 미만입니다.`);
  }
  const rawPercent = ((calibMax - rawDistance) / (calibMax - calibMin)) * 100;
  if (rawPercent <= DEADZONE_PERCENT) return 0;
  return Math.round(Math.min(100, rawPercent));
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

export interface SampleSummary {
  average: number; // 0.01mm 정수
  spread: number; // 이상치 제외 후 최대−최소
  kept: number;
  total: number;
  stable: boolean;
}

/**
 * 3초 수집 구간의 대표 거리. 중앙값 기준 MAD×3 를 벗어난 튀는 값(반사 노이즈)을 버리고 평균한다.
 * 남은 값의 흔들림이 1mm 이하이고 80% 이상 남아야 안정(stable)으로 본다.
 */
export function summarizeSamples(samples: readonly number[]): SampleSummary {
  if (samples.length === 0) return { average: 0, spread: 0, kept: 0, total: 0, stable: false };

  const sorted = [...samples].sort((a, b) => a - b);
  const med = median(sorted);
  const mad = median(sorted.map((value) => Math.abs(value - med)).sort((a, b) => a - b));
  const limit = Math.max(mad * OUTLIER_MAD_FACTOR, STABILITY_TOLERANCE / 2);
  const kept = sorted.filter((value) => Math.abs(value - med) <= limit);

  const average = Math.round(kept.reduce((sum, value) => sum + value, 0) / kept.length);
  const spread = (kept[kept.length - 1] ?? 0) - (kept[0] ?? 0);
  return {
    average,
    spread,
    kept: kept.length,
    total: samples.length,
    stable: spread <= STABILITY_TOLERANCE && kept.length / samples.length >= MIN_KEPT_RATIO,
  };
}

/** 0.01mm 정수 → "120.50" */
export function formatMillimeters(distance: number): string {
  return (distance / 100).toFixed(2);
}
