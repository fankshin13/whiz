import type { TriggerType } from "./forensics";

export type DeviceConnectionStatus = "NORMAL" | "WARNING" | "UNCALIBRATED";

export interface FleetVehicleSummary {
  vehicleId: string;
  plateNumber: string;
  modelName: string;
  modelYear: number | null;
  assignedDriverName: string | null;
  deviceId: string | null;
  deviceSerialNumber: string | null;
  lastSyncedAt: string | null;
  connectionStatus: DeviceConnectionStatus;
  recentEventCount: number; // 선택 기간
  lastTriggerType: TriggerType | null;
  lastEventAt: string | null;
  lastEventId: string | null;
}

export interface DailyEventStat {
  date: string; // YYYY-MM-DD (Asia/Seoul)
  shockCount: number;
  suddenAccelCount: number;
  manualCount: number;
  periodicCount: number;
  totalCount: number;
}

export interface FleetDashboardOverview {
  organizationName: string;
  periodDays: number;
  totalVehicles: number;
  connectedDevices: number; // 24시간 내 동기화 + 보정 완료
  uncalibratedDevices: number; // 단말 없음 또는 공장 기본값
  warningDevices: number; // 24시간 넘게 미동기화
  totalEventsInPeriod: number;
  tamperedEventsInPeriod: number;
  dailyStats: DailyEventStat[];
  vehicles: FleetVehicleSummary[];
}
