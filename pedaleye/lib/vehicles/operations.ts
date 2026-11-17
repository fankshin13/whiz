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

/** 한국 자동차 번호판: (지역 2글자) + 2~3자리 숫자 + 한글 1글자 + 4자리 숫자. 띄어쓰기는 있어도 없어도 된다. */
export const PLATE_PATTERN = /^([가-힣]{2})?\s?\d{2,3}\s?[가-힣]\s?\d{4}$/;
export const PLATE_FORMAT_ERROR = "올바른 차량 번호 형식을 입력해주세요 (예: 12가 3456).";
export const PLATE_DUPLICATE_ERROR = "이미 등록된 차량 번호입니다. 기존 차량 정보를 확인해주세요.";

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => value || undefined)
    .optional();

export const upsertVehicleSchema = z.object({
  id: z.guid().optional(),
  org_id: z.guid().optional(), // super_admin 이 새 차량을 등록할 때만. org_admin 은 무시하고 본인 조직으로 강제.
  plate_number: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, " "))
    .pipe(z.string().regex(PLATE_PATTERN, PLATE_FORMAT_ERROR)),
  model_name: z.string().trim().min(1, "모델명을 입력해 주세요.").max(100, "모델명은 100자 이하로 입력해 주세요."),
  model_year: z.coerce
    .number({ error: "연식은 숫자로 입력해 주세요." })
    .int("연식은 숫자로 입력해 주세요.")
    .min(1980, "연식은 1980년 이후로 입력해 주세요.")
    .refine((year) => year <= new Date().getFullYear() + 1, "연식이 너무 큽니다. 다시 확인해 주세요.")
    .optional(),
  vin_masked: optionalText(17, "차대번호는 17자 이하로 입력해 주세요."),
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
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "차량 정보 입력값을 확인해 주세요." };
  const { id, org_id: requestedOrg, ...fields } = parsed.data;

  let query;
  if (id) {
    // 수정: 소속 조직은 바꾸지 않는다(다른 조직으로 옮기면 운전자·기록 연결이 꼬임). 조직 관리자는 RLS 로 자기 조직 차량만
    query = supabase.from("vehicles").update(fields).eq("id", id).select().maybeSingle();
  } else {
    const orgId = user.role === "super_admin" ? requestedOrg : user.orgId;
    if (!orgId) return { ok: false, error: "차량을 등록할 조직을 지정해 주세요." };
    query = supabase.from("vehicles").insert({ ...fields, org_id: orgId }).select().single();
  }
  const { data, error } = await query;

  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    if (error.code === "23505") return { ok: false, error: PLATE_DUPLICATE_ERROR };
    if (error.code === "23503") return { ok: false, error: "선택한 조직을 찾을 수 없습니다." };
    if (error.code === "23514") return { ok: false, error: "배정 운전자는 같은 조직 소속이어야 합니다." };
    console.error("upsertVehicle failed", { code: error.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  if (!data) return { ok: false, error: "차량을 찾을 수 없거나 수정 권한이 없습니다." };
  return { ok: true, data };
}

/**
 * 차량의 배정 운전자 해제. 해제된 운전자는 이 차량과 그 사고 기록을 더 이상 볼 수 없다(현재 배정 차량 기준 열람).
 * 조직 관리자는 자기 조직 차량만(서버 확인 + RLS).
 */
export async function unassignDriver(supabase: Client, user: Operator, vehicleId: unknown): Promise<OperationResult<null>> {
  if (!canManageVehicles(user)) return { ok: false, error: NO_PERMISSION };
  const id = z.guid().safeParse(vehicleId);
  if (!id.success) return { ok: false, error: "차량을 찾을 수 없습니다." };

  const { data, error } = await supabase
    .from("vehicles")
    .update({ assigned_user_id: null })
    .eq("id", id.data)
    .select("id");
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    console.error("unassignDriver failed", { code: error.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  if (data.length === 0) return { ok: false, error: "차량을 찾을 수 없거나 관리 권한이 없습니다." };
  return { ok: true, data: null };
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
