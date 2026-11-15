/** 관제 집계(순수 함수). 서버 로더가 RLS 로 읽어 온 행만 받는다. */
import type { DailyEventStat, DeviceConnectionStatus, FleetDashboardOverview, FleetVehicleSummary } from "@/types/fleet-monitoring";
import type { TriggerType } from "@/types/forensics";

export const SYNC_FRESH_MS = 24 * 3_600_000;
export const PERIOD_OPTIONS = [7, 30] as const;

export interface VehicleRow {
  id: string;
  plate_number: string;
  model_name: string;
  model_year: number | null;
  driver: { name: string } | null;
  device: {
    id: string;
    serial_number: string;
    last_synced_at: string | null;
    accel_calib_min: number;
    accel_calib_max: number;
    brake_calib_min: number;
    brake_calib_max: number;
  } | null; // 차량당 단말 1개(devices.vehicle_id 고유)
}

export interface SessionRow {
  id: string;
  device_id: string;
  trigger_type: TriggerType;
  start_time: string;
  integrity_verified: boolean;
}

const seoulDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

export function seoulDateKey(ms: number): string {
  return seoulDate.format(ms);
}

export function connectionStatus(device: VehicleRow["device"] | undefined, nowMs: number): DeviceConnectionStatus {
  if (
    !device ||
    (device.accel_calib_min === 0 && device.accel_calib_max === 4095 && device.brake_calib_min === 0 && device.brake_calib_max === 4095)
  ) {
    return "UNCALIBRATED";
  }
  if (!device.last_synced_at || nowMs - Date.parse(device.last_synced_at) > SYNC_FRESH_MS) return "WARNING";
  return "NORMAL";
}

export function buildFleetOverview(
  organizationName: string,
  vehicles: readonly VehicleRow[],
  sessions: readonly SessionRow[],
  nowMs: number,
  periodDays: number,
): FleetDashboardOverview {
  const since = nowMs - periodDays * 86_400_000;
  const inPeriod = sessions.filter((s) => Date.parse(s.start_time) >= since && Date.parse(s.start_time) <= nowMs);

  const days: DailyEventStat[] = Array.from({ length: periodDays }, (_, i) => ({
    date: seoulDateKey(nowMs - (periodDays - 1 - i) * 86_400_000),
    shockCount: 0,
    suddenAccelCount: 0,
    manualCount: 0,
    periodicCount: 0,
    totalCount: 0,
  }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const session of inPeriod) {
    const day = byDate.get(seoulDateKey(Date.parse(session.start_time)));
    if (!day) continue;
    if (session.trigger_type === "shock") day.shockCount += 1;
    else if (session.trigger_type === "sudden_accel") day.suddenAccelCount += 1;
    else if (session.trigger_type === "manual") day.manualCount += 1;
    else day.periodicCount += 1;
    day.totalCount += 1;
  }

  const summaries: FleetVehicleSummary[] = vehicles.map((vehicle) => {
    const device = vehicle.device;
    const own = inPeriod
      .filter((s) => device && s.device_id === device.id)
      .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
    const latest = own[0];
    return {
      vehicleId: vehicle.id,
      plateNumber: vehicle.plate_number,
      modelName: vehicle.model_name,
      modelYear: vehicle.model_year,
      assignedDriverName: vehicle.driver?.name ?? null,
      deviceId: device?.id ?? null,
      deviceSerialNumber: device?.serial_number ?? null,
      lastSyncedAt: device?.last_synced_at ?? null,
      connectionStatus: connectionStatus(device, nowMs),
      recentEventCount: own.length,
      lastTriggerType: latest?.trigger_type ?? null,
      lastEventAt: latest?.start_time ?? null,
      lastEventId: latest?.id ?? null,
    };
  });

  const count = (status: DeviceConnectionStatus) => summaries.filter((v) => v.connectionStatus === status).length;
  return {
    organizationName,
    periodDays,
    totalVehicles: summaries.length,
    connectedDevices: count("NORMAL"),
    warningDevices: count("WARNING"),
    uncalibratedDevices: count("UNCALIBRATED"),
    totalEventsInPeriod: inPeriod.length,
    tamperedEventsInPeriod: inPeriod.filter((s) => !s.integrity_verified).length,
    dailyStats: days,
    vehicles: summaries,
  };
}
