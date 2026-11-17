import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { CurrentUser } from "@/lib/auth/get-current-user";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type Operator = Pick<CurrentUser, "role" | "orgId">;

export type OperationResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NO_PERMISSION = "이 작업을 수행할 권한이 없습니다.";
const TEMPORARY_FAILURE = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";

export const SERIAL_PATTERN = /^PE-\d{4}-\d{6}$/;
export const SERIAL_FORMAT_ERROR = "일련번호 형식이 올바르지 않습니다. (예: PE-2026-000001)";
export const SERIAL_DUPLICATE_ERROR = "이미 등록된 단말 일련번호입니다.";
export const MAC_PATTERN = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;
export const MAC_FORMAT_ERROR = "MAC 주소 형식이 올바르지 않습니다. (예: AA:BB:CC:DD:EE:FF)";

const MOUNT_ERRORS: Record<string, string> = {
  FORBIDDEN: NO_PERMISSION,
  VEHICLE_NOT_FOUND: "차량을 찾을 수 없거나 관리 권한이 없습니다.",
  DEVICE_NOT_FOUND: "단말을 찾을 수 없거나 관리 권한이 없습니다.",
  DEVICE_MOUNTED_ELSEWHERE: "이미 다른 차량에 장착된 단말입니다. 먼저 장착을 해제해 주세요.",
  VEHICLE_HAS_DEVICE: "이 차량에는 이미 다른 단말이 장착되어 있습니다. 교체하려면 교체에 동의해 주세요.",
};

function isAdmin(user: Operator): boolean {
  return user.role === "super_admin" || (user.role === "org_admin" && user.orgId !== null);
}

/** 공장 기본 보정값(0~4095) 그대로면 아직 보정 전이다. */
export function isFactoryCalibrated(device: {
  accel_calib_min: number;
  accel_calib_max: number;
  brake_calib_min: number;
  brake_calib_max: number;
}): boolean {
  return device.accel_calib_min === 0 && device.accel_calib_max === 4095 && device.brake_calib_min === 0 && device.brake_calib_max === 4095;
}

export interface DeviceListItem {
  id: string;
  serialNumber: string;
  macAddress: string | null;
  hardwareRev: string;
  firmwareVersion: string;
  orgId: string | null;
  orgName: string | null;
  vehicle: { id: string; plateNumber: string } | null;
  needsCalibration: boolean;
  lastSyncedAt: string | null;
}

/** 관리 화면 단말 목록. 범위는 RLS 가 정한다(슈퍼 관리자 전체, 조직 관리자 자기 조직 장착·재고). */
export async function listDevices(supabase: Client, user: Operator): Promise<DeviceListItem[]> {
  if (!isAdmin(user)) return [];
  const { data, error } = await supabase
    .from("devices")
    .select(
      "id, serial_number, mac_address, hardware_rev, firmware_version, org_id, accel_calib_min, accel_calib_max, brake_calib_min, brake_calib_max, last_synced_at, organization:organizations(name), vehicle:vehicles(id, plate_number)",
    )
    .order("serial_number");
  if (error) throw new Error(`단말 조회 실패 (${error.code})`);

  return data
    .filter((row) => user.role === "super_admin" || row.org_id === user.orgId)
    .map((row) => ({
      id: row.id,
      serialNumber: row.serial_number,
      macAddress: row.mac_address,
      hardwareRev: row.hardware_rev,
      firmwareVersion: row.firmware_version,
      orgId: row.org_id,
      orgName: row.organization?.name ?? null,
      vehicle: row.vehicle ? { id: row.vehicle.id, plateNumber: row.vehicle.plate_number } : null,
      needsCalibration: row.vehicle !== null && isFactoryCalibrated(row),
      lastSyncedAt: row.last_synced_at,
    }));
}

export const registerDeviceSchema = z.object({
  org_id: z.guid({ error: "단말을 배정할 조직을 선택해 주세요." }),
  serial_number: z.string().trim().toUpperCase().regex(SERIAL_PATTERN, SERIAL_FORMAT_ERROR),
  mac_address: z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => value.replace(/-/g, ":"))
    .refine((value) => value === "" || MAC_PATTERN.test(value), MAC_FORMAT_ERROR)
    .transform((value) => value || null)
    .optional(),
  hardware_rev: z.string().trim().max(20, "하드웨어 버전은 20자 이하로 입력해 주세요.").transform((value) => value || "v1.0").optional(),
  firmware_version: z.string().trim().max(20, "펌웨어 버전은 20자 이하로 입력해 주세요.").transform((value) => value || "1.0.0").optional(),
});

/** 단말 재고 등록(슈퍼 관리자만). 등록한 조직의 미장착 재고가 된다. */
export async function registerDevice(supabase: Client, user: Operator, input: unknown): Promise<OperationResult<{ id: string; serialNumber: string }>> {
  if (user.role !== "super_admin") return { ok: false, error: NO_PERMISSION };
  const parsed = registerDeviceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "단말 정보 입력값을 확인해 주세요." };

  const { data, error } = await supabase.from("devices").insert(parsed.data).select("id, serial_number").single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: SERIAL_DUPLICATE_ERROR };
    if (error.code === "23503") return { ok: false, error: "선택한 조직을 찾을 수 없습니다." };
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    console.error("registerDevice failed", { code: error.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  return { ok: true, data: { id: data.id, serialNumber: data.serial_number } };
}

const mountSchema = z.object({ deviceId: z.guid(), vehicleId: z.guid(), replace: z.boolean().default(false) });

/**
 * 재고 단말을 차량에 장착. 차량에 이미 단말이 있으면 replace 일 때만 기존 단말을 해제(그 조직 재고로 복귀)하고 교체한다.
 * 장착된 단말의 보정값은 공장 기본값으로 초기화된다(장착 후 보정 필요). 권한·원자성은 DB 함수 mount_device 가 보장.
 */
export async function mountDevice(
  supabase: Client,
  user: Operator,
  input: unknown,
): Promise<OperationResult<{ deviceId: string; replacedSerial: string | null }>> {
  if (!isAdmin(user)) return { ok: false, error: NO_PERMISSION };
  const parsed = mountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "장착할 단말과 차량을 선택해 주세요." };

  const { data, error } = await supabase.rpc("mount_device", {
    p_device_id: parsed.data.deviceId,
    p_vehicle_id: parsed.data.vehicleId,
    p_replace: parsed.data.replace,
  });
  if (error) {
    const known = MOUNT_ERRORS[error.message];
    if (known) return { ok: false, error: known };
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    console.error("mountDevice failed", { code: error.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  const result = data as { device_id: string; replaced_serial: string | null };
  return { ok: true, data: { deviceId: result.device_id, replacedSerial: result.replaced_serial } };
}

/** 장착 해제. 단말은 소속 조직의 미장착 재고로 돌아간다. 조직 관리자는 자기 조직 단말만(RLS). */
export async function unmountDevice(supabase: Client, user: Operator, deviceId: unknown): Promise<OperationResult<null>> {
  if (!isAdmin(user)) return { ok: false, error: NO_PERMISSION };
  const id = z.guid().safeParse(deviceId);
  if (!id.success) return { ok: false, error: "단말을 찾을 수 없습니다." };

  const { data, error } = await supabase.from("devices").update({ vehicle_id: null }).eq("id", id.data).not("vehicle_id", "is", null).select("id");
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    console.error("unmountDevice failed", { code: error.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  if (data.length === 0) return { ok: false, error: "장착된 단말을 찾을 수 없거나 관리 권한이 없습니다." };
  return { ok: true, data: null };
}
