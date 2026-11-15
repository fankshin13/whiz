import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { CurrentUser } from "@/lib/auth/get-current-user";
import { MIN_STROKE } from "@/lib/telemetry/displacement-engine";
import type { Database } from "@/lib/supabase/database.types";
import type { DeviceCalibrationData } from "@/types/calibration";

type Client = SupabaseClient<Database>;
type Operator = Pick<CurrentUser, "id" | "role" | "orgId">;

const distance = z.number().int().min(100).max(50000);

export const calibrationPayloadSchema = z
  .object({
    deviceId: z.guid(),
    accelCalibMin: distance,
    accelCalibMax: distance,
    brakeCalibMin: distance,
    brakeCalibMax: distance,
  })
  .refine((data) => data.accelCalibMax - data.accelCalibMin >= MIN_STROKE, {
    message: "가속 페달 가동 범위가 너무 작습니다(최소 5mm 이상 필요).",
  })
  .refine((data) => data.brakeCalibMax - data.brakeCalibMin >= MIN_STROKE, {
    message: "제동 페달 가동 범위가 너무 작습니다(최소 5mm 이상 필요).",
  });

/**
 * 사용자가 보정할 수 있는 단말 목록(차량에 장착된 것만).
 * super_admin 전체, org_admin 소속 조직, driver 본인 배정 차량. 그 외 역할은 빈 목록.
 */
export async function listCalibrationTargets(supabase: Client, user: Operator): Promise<DeviceCalibrationData[]> {
  if (user.role === "investigator") return [];

  const { data, error } = await supabase
    .from("devices")
    .select(
      "id, serial_number, accel_calib_min, accel_calib_max, brake_calib_min, brake_calib_max, last_synced_at, vehicle:vehicles!inner(id, plate_number, org_id, assigned_user_id)",
    )
    .order("serial_number");
  if (error) throw new Error(`단말 조회 실패 (${error.code})`);

  return data
    .filter(({ vehicle }) =>
      user.role === "super_admin"
        ? true
        : user.role === "org_admin"
          ? vehicle.org_id === user.orgId
          : vehicle.assigned_user_id === user.id,
    )
    .map((row) => ({
      deviceId: row.id,
      vehicleId: row.vehicle.id,
      plateNumber: row.vehicle.plate_number,
      serialNumber: row.serial_number,
      accelCalibMin: row.accel_calib_min,
      accelCalibMax: row.accel_calib_max,
      brakeCalibMin: row.brake_calib_min,
      brakeCalibMax: row.brake_calib_max,
      lastSyncedAt: row.last_synced_at,
    }));
}

/** 단말 하나의 보정 정보. 권한 밖의 deviceId 는 null(존재 여부도 숨김). driver 는 생략 시 본인 단말. */
export async function getDeviceCalibrationProjection(
  supabase: Client,
  user: Operator,
  deviceId?: string,
): Promise<DeviceCalibrationData | null> {
  const targets = await listCalibrationTargets(supabase, user);
  if (deviceId) return targets.find((target) => target.deviceId === deviceId) ?? null;
  return targets.length === 1 ? (targets[0] ?? null) : null;
}

export type CalibrationUpdateResult =
  | { success: true }
  | { success: false; status: 400 | 403 | 500; error: string };

/** 보정값 저장. 서버에서 권한을 직접 확인한 뒤 RLS 가 한 번 더 막는다. */
export async function updateDeviceCalibration(
  supabase: Client,
  user: Operator,
  input: unknown,
): Promise<CalibrationUpdateResult> {
  const parsed = calibrationPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, status: 400, error: parsed.error.issues[0]?.message ?? "보정값을 확인해 주세요." };
  }
  const payload = parsed.data;

  const target = await getDeviceCalibrationProjection(supabase, user, payload.deviceId);
  if (!target) return { success: false, status: 403, error: "이 단말의 보정값을 변경할 권한이 없습니다." };

  const { data, error } = await supabase
    .from("devices")
    .update({
      accel_calib_min: payload.accelCalibMin,
      accel_calib_max: payload.accelCalibMax,
      brake_calib_min: payload.brakeCalibMin,
      brake_calib_max: payload.brakeCalibMax,
    })
    .eq("id", payload.deviceId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "42501") return { success: false, status: 403, error: "이 단말의 보정값을 변경할 권한이 없습니다." };
    if (error.code === "23514") return { success: false, status: 400, error: "페달 가동 범위가 너무 작습니다(최소 5mm 이상 필요)." };
    console.error("updateDeviceCalibration failed", { code: error.code });
    return { success: false, status: 500, error: "일시적인 오류가 발생했습니다" };
  }
  if (!data) return { success: false, status: 403, error: "이 단말의 보정값을 변경할 권한이 없습니다." };
  return { success: true };
}
