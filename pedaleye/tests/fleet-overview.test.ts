import { describe, expect, it } from "vitest";

import { buildFleetOverview, connectionStatus, seoulDateKey, type SessionRow, type VehicleRow } from "@/lib/fleet/overview";

const NOW = Date.UTC(2026, 10, 15, 3, 0, 0); // 2026-11-15 12:00 KST
const calibrated = { accel_calib_min: 8050, accel_calib_max: 12050, brake_calib_min: 9500, brake_calib_max: 13000 };
const factory = { accel_calib_min: 0, accel_calib_max: 4095, brake_calib_min: 0, brake_calib_max: 4095 };
const iso = (ms: number) => new Date(ms).toISOString();

const vehicles: VehicleRow[] = [
  { id: "v1", plate_number: "12가 3456", model_name: "아반떼", model_year: 2021, driver: { name: "A" }, device: { id: "d1", serial_number: "S1", last_synced_at: iso(NOW - 3_600_000), ...calibrated } },
  { id: "v2", plate_number: "34나 7890", model_name: "쏘렌토", model_year: 2019, driver: { name: "B" }, device: { id: "d2", serial_number: "S2", last_synced_at: iso(NOW - 3 * 86_400_000), ...calibrated } },
  { id: "v3", plate_number: "56다 1004", model_name: "포터2", model_year: 2022, driver: null, device: null },
  { id: "v4", plate_number: "78라 1111", model_name: "레이", model_year: null, driver: null, device: { id: "d4", serial_number: "S4", last_synced_at: iso(NOW), ...factory } },
];
const sessions: SessionRow[] = [
  { id: "e1", device_id: "d1", trigger_type: "sudden_accel", start_time: iso(NOW - 3_600_000), integrity_verified: true },
  { id: "e2", device_id: "d1", trigger_type: "shock", start_time: iso(NOW - 2 * 86_400_000), integrity_verified: false },
  { id: "e3", device_id: "d2", trigger_type: "manual", start_time: iso(NOW - 6 * 86_400_000), integrity_verified: true },
  { id: "e4", device_id: "d2", trigger_type: "manual", start_time: iso(NOW - 20 * 86_400_000), integrity_verified: true },
];

describe("단말 연결 상태", () => {
  it("보정 전·단말 없음 → 미교정, 24시간 넘게 미동기화 → 주의, 나머지 정상", () => {
    expect(connectionStatus(vehicles[0]?.device, NOW)).toBe("NORMAL");
    expect(connectionStatus(vehicles[1]?.device, NOW)).toBe("WARNING");
    expect(connectionStatus(undefined, NOW)).toBe("UNCALIBRATED");
    expect(connectionStatus(vehicles[3]?.device, NOW)).toBe("UNCALIBRATED");
    expect(connectionStatus({ id: "x", serial_number: "x", last_synced_at: null, ...calibrated }, NOW)).toBe("WARNING");
  });
});

describe("관제 집계", () => {
  it("7일: KPI·일자별(서울 기준)·차량별 최근 이벤트", () => {
    const o = buildFleetOverview("화성시", vehicles, sessions, NOW, 7);
    expect(o).toMatchObject({ totalVehicles: 4, connectedDevices: 1, warningDevices: 1, uncalibratedDevices: 2, totalEventsInPeriod: 3, tamperedEventsInPeriod: 1 });
    expect(o.dailyStats).toHaveLength(7);
    expect(o.dailyStats[6]).toMatchObject({ date: "2026-11-15", suddenAccelCount: 1, totalCount: 1 });
    expect(o.dailyStats[4]).toMatchObject({ date: "2026-11-13", shockCount: 1 });
    expect(o.dailyStats[0]).toMatchObject({ date: "2026-11-09", manualCount: 1 });
    expect(o.vehicles[0]).toMatchObject({ recentEventCount: 2, lastTriggerType: "sudden_accel", lastEventId: "e1", connectionStatus: "NORMAL" });
    expect(o.vehicles[2]).toMatchObject({ deviceId: null, recentEventCount: 0, connectionStatus: "UNCALIBRATED" });
  });

  it("30일이면 20일 전 이벤트까지 포함", () => {
    const o = buildFleetOverview("화성시", vehicles, sessions, NOW, 30);
    expect(o.totalEventsInPeriod).toBe(4);
    expect(o.dailyStats).toHaveLength(30);
    expect(o.vehicles[1]?.recentEventCount).toBe(2);
  });

  it("자정 직후(서울) 이벤트는 그날로 집계", () => {
    expect(seoulDateKey(Date.UTC(2026, 10, 14, 15, 5))).toBe("2026-11-15");
  });

  it("차량이 없으면 0", () => {
    expect(buildFleetOverview("빈 조직", [], [], NOW, 7)).toMatchObject({ totalVehicles: 0, totalEventsInPeriod: 0 });
  });
});
