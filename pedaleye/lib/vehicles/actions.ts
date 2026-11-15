"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { bindDeviceToVehicle, upsertVehicle } from "@/lib/vehicles/operations";

const LOGIN_REQUIRED = { ok: false, error: "로그인이 필요합니다." } as const;

export async function upsertVehicleAction(input: unknown) {
  const user = await getCurrentUser();
  if (!user) return LOGIN_REQUIRED;
  const result = await upsertVehicle(await createClient(), user, input);
  if (result.ok) revalidatePath("/vehicles");
  return result;
}

export async function bindDeviceToVehicleAction(input: unknown) {
  const user = await getCurrentUser();
  if (!user) return LOGIN_REQUIRED;
  const result = await bindDeviceToVehicle(await createClient(), user, input);
  if (result.ok) revalidatePath("/vehicles");
  return result;
}
