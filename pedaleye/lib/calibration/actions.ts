"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { updateDeviceCalibration } from "@/lib/calibration/operations";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";

export type CalibrationActionState = { error: string | null; status?: number };

export async function updateDeviceCalibrationAction(
  _prev: CalibrationActionState,
  formData: FormData,
): Promise<CalibrationActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다. 다시 로그인해 주세요.", status: 401 };

  const toInt = (name: string) => Number(formData.get(name));
  const result = await updateDeviceCalibration(await createClient(), user, {
    deviceId: formData.get("deviceId"),
    accelCalibMin: toInt("accelCalibMin"),
    accelCalibMax: toInt("accelCalibMax"),
    brakeCalibMin: toInt("brakeCalibMin"),
    brakeCalibMax: toInt("brakeCalibMax"),
  });

  if (!result.success) return { error: result.error, status: result.status };

  revalidatePath("/devices/calibrate");
  revalidatePath("/dashboard");
  redirect("/dashboard?calibrated=1");
}
