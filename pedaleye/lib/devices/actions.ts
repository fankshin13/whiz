"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auditIfDenied } from "@/lib/audit/operations";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { mountDevice, registerDevice, setDevicePublicKey, unmountDevice } from "@/lib/devices/operations";
import { createClient } from "@/lib/supabase/server";

const LOGIN_REQUIRED = "로그인이 필요합니다.";

function revalidateDeviceViews(vehicleId?: string) {
  revalidatePath("/devices");
  revalidatePath("/vehicles");
  revalidatePath("/devices/calibrate");
  if (vehicleId) revalidatePath(`/vehicles/${vehicleId}`);
}

type RegisterValues = { orgId: string; serialNumber: string; macAddress: string; hardwareRev: string; firmwareVersion: string; publicKey: string };
export type RegisterDeviceState = { ok: null } | { ok: false; error: string; values: RegisterValues };

/** 단말 재고 등록(슈퍼 관리자). 실패하면 입력값을 돌려줘 폼을 다시 채운다. */
export async function registerDeviceAction(_prev: RegisterDeviceState, formData: FormData): Promise<RegisterDeviceState> {
  const text = (name: string, max: number) => String(formData.get(name) ?? "").slice(0, max);
  const values: RegisterValues = {
    orgId: text("orgId", 64),
    serialNumber: text("serialNumber", 30),
    macAddress: text("macAddress", 30),
    hardwareRev: text("hardwareRev", 30),
    firmwareVersion: text("firmwareVersion", 30),
    publicKey: text("publicKey", 200),
  };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: LOGIN_REQUIRED, values };

  const supabase = await createClient();
  const result = await registerDevice(supabase, user, {
    org_id: values.orgId,
    serial_number: values.serialNumber,
    mac_address: values.macAddress,
    hardware_rev: values.hardwareRev,
    firmware_version: values.firmwareVersion,
    auth_public_key: values.publicKey,
  });
  if (!result.ok) {
    await auditIfDenied(supabase, result.error, { action: "DEVICE_CREATE", targetType: "device", targetName: values.serialNumber });
    return { ok: false, error: result.error, values };
  }
  revalidateDeviceViews();
  // 대화상자가 닫히면서 결과를 잃지 않도록 서버에서 안내 화면으로 보낸다
  redirect(`/devices?filter=inventory&notice=registered&device=${result.data.id}`);
}

export type MountDeviceState = { ok: null } | { ok: false; error: string; vehicleId: string };

/** 재고 단말을 차량에 장착(필요하면 교체). */
export async function mountDeviceAction(_prev: MountDeviceState, formData: FormData): Promise<MountDeviceState> {
  const vehicleId = String(formData.get("vehicleId") ?? "").slice(0, 64);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: LOGIN_REQUIRED, vehicleId };

  const supabase = await createClient();
  const deviceId = String(formData.get("deviceId") ?? "").slice(0, 64);
  const result = await mountDevice(supabase, user, {
    deviceId,
    vehicleId,
    replace: formData.get("replace") === "on",
  });
  if (!result.ok) {
    await auditIfDenied(supabase, result.error, { action: "DEVICE_MOUNT", targetType: "device", targetId: deviceId, targetName: `차량 ${vehicleId}` });
    return { ok: false, error: result.error, vehicleId };
  }
  revalidateDeviceViews(vehicleId);
  // 장착되면 단말이 재고 목록에서 빠져 대화상자가 사라지므로, 결과(보정 바로가기 포함)는 안내 화면에서 보여 준다
  const replaced = result.data.replacedSerial ? `&replaced=${encodeURIComponent(result.data.replacedSerial)}` : "";
  redirect(`/devices?notice=mounted&device=${result.data.deviceId}${replaced}`);
}

export type UnmountDeviceState = { ok: boolean | null; error: string | null };

/** 장착 해제. 단말이 들어 있던 행 모양이 바뀌므로 서버에서 바로 안내 화면으로 보낸다. */
export async function unmountDeviceAction(_prev: UnmountDeviceState, formData: FormData): Promise<UnmountDeviceState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: LOGIN_REQUIRED };
  const vehicleId = String(formData.get("vehicleId") ?? "").slice(0, 64);
  const deviceId = String(formData.get("deviceId") ?? "").slice(0, 64);
  const supabase = await createClient();
  const result = await unmountDevice(supabase, user, deviceId);
  if (!result.ok) {
    await auditIfDenied(supabase, result.error, { action: "DEVICE_UNMOUNT", targetType: "device", targetId: deviceId });
    return { ok: false, error: result.error };
  }
  revalidateDeviceViews(vehicleId || undefined);
  redirect(`/devices?filter=inventory&notice=unmounted&device=${encodeURIComponent(deviceId)}`);
}

export type DeviceKeyState = { ok: null } | { ok: false; error: string; publicKey: string; reason: string };

/** 인증 공개키 교체·해제(슈퍼 관리자). 성공하면 단말 목록 안내로 돌아간다. */
export async function setDevicePublicKeyAction(_prev: DeviceKeyState, formData: FormData): Promise<DeviceKeyState> {
  const deviceId = String(formData.get("deviceId") ?? "").slice(0, 64);
  const revoke = formData.get("revoke") === "on";
  const publicKey = revoke ? "" : String(formData.get("publicKey") ?? "").slice(0, 200);
  const reason = String(formData.get("reason") ?? "").slice(0, 200);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: LOGIN_REQUIRED, publicKey, reason };
  if (!revoke && !publicKey.trim()) return { ok: false, error: "새 공개키를 입력하거나 '키 등록 해제'를 선택해 주세요.", publicKey, reason };

  const supabase = await createClient();
  const result = await setDevicePublicKey(supabase, user, { deviceId, publicKey, reason });
  if (!result.ok) {
    await auditIfDenied(supabase, result.error, { action: "DEVICE_KEY_UPDATE", targetType: "device", targetId: deviceId });
    return { ok: false, error: result.error, publicKey, reason };
  }
  revalidateDeviceViews();
  redirect(`/devices?notice=${revoke ? "key_revoked" : "key_updated"}&device=${encodeURIComponent(deviceId)}`);
}
