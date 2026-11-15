import type { DeviceConnectionStatus } from "@/types/fleet-monitoring";

export const STATUS_LABELS: Record<DeviceConnectionStatus, string> = {
  NORMAL: "정상",
  WARNING: "주의(미동기화)",
  UNCALIBRATED: "미교정",
};

export const TRIGGER_LABELS = { shock: "충격", sudden_accel: "급가감속", manual: "수동 백업", periodic: "정기 기록" } as const;

/** 이벤트 유형 → 범주 색(고정 순서) */
export const TRIGGER_SERIES = [
  { key: "suddenAccelCount", type: "sudden_accel", label: "급가감속", fill: "fill-series-1", bg: "bg-series-1" },
  { key: "shockCount", type: "shock", label: "충격", fill: "fill-series-2", bg: "bg-series-2" },
  { key: "manualCount", type: "manual", label: "수동 백업", fill: "fill-series-3", bg: "bg-series-3" },
  { key: "periodicCount", type: "periodic", label: "정기 기록", fill: "fill-series-4", bg: "bg-series-4" },
] as const;
