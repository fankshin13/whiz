import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { CurrentUser } from "@/lib/auth/get-current-user";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type Vehicle = Database["public"]["Tables"]["vehicles"]["Row"];
type Device = Database["public"]["Tables"]["devices"]["Row"];
type Operator = Pick<CurrentUser, "role" | "orgId">;

export type OperationResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NO_PERMISSION = "이 작업을 수행할 권한이 없습니다.";
const TEMPORARY_FAILURE = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";

export const upsertVehicleSchema = z.object({
  id: z.guid().optional(),
  org_id: z.guid().optional(), // super_admin 전용. org_admin 은 무시하고 본인 조직으로 강제.
  plate_number: z.string().trim().min(1).max(20),
  model_name: z.string().trim().min(1).max(100),
  model_year: z.number().int().min(1980).max(2100).optional(),
  assigned_user_id: z.guid().nullable().optional(),
});

export const bindDeviceSchema = z.object({
  serial_number: z.string().trim().min(1).max(64),
  vehicle_id: z.guid(),
});

function canManageVehicles(user: Operator): boolean {
  return user.role === "super_admin" || (user.role === "org_admin" && user.orgId !== null);
}

/** 차량 생성/수정. org_id 는 세션 사용자 기준으로 강제 주입한다. RLS 가 2차로 검증. */
export async function upsertVehicle(
  supabase: Client,
  user: Operator,
  input: unknown,
): Promise<OperationResult<Vehicle>> {
  if (!canManageVehicles(user)) return { ok: false, error: NO_PERMISSION };

  const parsed = upsertVehicleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "차량 정보 입력값을 확인해 주세요." };
  const { id, org_id: requestedOrg, ...fields } = parsed.data;

  const orgId = user.role === "super_admin" ? requestedOrg : user.orgId;
  if (!orgId) return { ok: false, error: "차량을 등록할 조직을 지정해 주세요." };

  const row = { ...fields, org_id: orgId };
  const query = id
    ? supabase.from("vehicles").update(row).eq("id", id).select().maybeSingle()
    : supabase.from("vehicles").insert(row).select().single();
  const { data, error } = await query;

  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "23514") return { ok: false, error: "배정 운전자는 같은 조직 소속이어야 합니다." };
    console.error("upsertVehicle failed", { code: error.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  if (!data) return { ok: false, error: "차량을 찾을 수 없거나 수정 권한이 없습니다." };
  return { ok: true, data };
}

/** 단말을 차량에 1:1 장착. 이미 다른 차량에 장착된 단말·차량은 거부한다(단일 UPDATE 로 원자 처리). */
export async function bindDeviceToVehicle(
  supabase: Client,
  user: Operator,
  input: unknown,
): Promise<OperationResult<Device>> {
  if (!canManageVehicles(user)) return { ok: false, error: NO_PERMISSION };

  const parsed = bindDeviceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "단말 일련번호와 차량을 확인해 주세요." };
  const { serial_number, vehicle_id } = parsed.data;

  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .select("id, org_id")
    .eq("id", vehicle_id)
    .maybeSingle();
  if (vehicleError) {
    console.error("bindDeviceToVehicle vehicle lookup failed", { code: vehicleError.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  if (!vehicle || (user.role === "org_admin" && vehicle.org_id !== user.orgId)) {
    return { ok: false, error: "차량을 찾을 수 없거나 관리 권한이 없습니다." };
  }

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("id, vehicle_id")
    .eq("serial_number", serial_number)
    .maybeSingle();
  if (deviceError) {
    console.error("bindDeviceToVehicle device lookup failed", { code: deviceError.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  if (!device) return { ok: false, error: "단말을 찾을 수 없습니다. 일련번호를 확인해 주세요." };
  if (device.vehicle_id !== null && device.vehicle_id !== vehicle_id) {
    return { ok: false, error: "이미 다른 차량에 장착된 단말입니다." };
  }

  const { data: updated, error: updateError } = await supabase
    .from("devices")
    .update({ vehicle_id })
    .eq("id", device.id)
    .or(`vehicle_id.is.null,vehicle_id.eq.${vehicle_id}`)
    .select()
    .maybeSingle();

  if (updateError) {
    if (updateError.code === "23505") return { ok: false, error: "이 차량에는 이미 다른 단말이 장착되어 있습니다." };
    console.error("bindDeviceToVehicle update failed", { code: updateError.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  if (!updated) return { ok: false, error: "이미 다른 차량에 장착된 단말입니다." };
  return { ok: true, data: updated };
}
