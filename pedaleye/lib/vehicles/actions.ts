"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auditIfDenied } from "@/lib/audit/operations";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { unassignDriver, upsertVehicle } from "@/lib/vehicles/operations";

const LOGIN_REQUIRED = { ok: false, error: "로그인이 필요합니다." } as const;

// ── 화면 폼용(useActionState) ───────────────────────────────────────────

type VehicleFormValues = { orgId: string; plateNumber: string; modelName: string; modelYear: string; vinMasked: string };
export type VehicleFormState =
  | { ok: null }
  | { ok: true; id: string; created: boolean }
  | { ok: false; error: string; values: VehicleFormValues };

/** 차량 등록·수정(id 가 있으면 수정). 실패하면 입력값을 돌려줘 폼을 다시 채운다. */
export async function saveVehicleAction(_prev: VehicleFormState, formData: FormData): Promise<VehicleFormState> {
  const text = (name: string, max: number) => String(formData.get(name) ?? "").slice(0, max);
  const values: VehicleFormValues = {
    orgId: text("orgId", 64),
    plateNumber: text("plateNumber", 30),
    modelName: text("modelName", 100),
    modelYear: text("modelYear", 8),
    vinMasked: text("vinMasked", 30),
  };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: LOGIN_REQUIRED.error, values };

  const id = String(formData.get("id") ?? "") || undefined;
  const supabase = await createClient();
  const result = await upsertVehicle(supabase, user, {
    id,
    org_id: values.orgId || undefined,
    plate_number: values.plateNumber,
    model_name: values.modelName,
    model_year: values.modelYear.trim() || undefined,
    vin_masked: values.vinMasked,
  });
  if (!result.ok) {
    await auditIfDenied(supabase, result.error, { action: id ? "VEHICLE_UPDATE" : "VEHICLE_CREATE", targetType: "vehicle", targetId: id, targetName: values.plateNumber });
    return { ok: false, error: result.error, values };
  }

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${result.data.id}`);
  return { ok: true, id: result.data.id, created: !id };
}

export type UnassignState = { ok: boolean | null; error: string | null };

export async function unassignDriverAction(_prev: UnassignState, formData: FormData): Promise<UnassignState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: LOGIN_REQUIRED.error };
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const supabase = await createClient();
  const result = await unassignDriver(supabase, user, vehicleId);
  if (!result.ok) {
    await auditIfDenied(supabase, result.error, { action: "VEHICLE_DRIVER_UNASSIGN", targetType: "vehicle", targetId: vehicleId });
    return { ok: false, error: result.error };
  }
  revalidatePath("/vehicles");
  // 해제되면 대화상자가 들어 있던 운전자 영역이 사라지므로, 서버에서 바로 안내 화면으로 보낸다
  redirect(`/vehicles/${vehicleId}?notice=unassigned`);
}
