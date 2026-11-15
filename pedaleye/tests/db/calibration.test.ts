import { afterAll, describe, expect, it } from "vitest";

import { getDeviceCalibrationProjection, updateDeviceCalibration } from "@/lib/calibration/operations";

import { ORG, adminClient, signedInClient } from "./helpers";

const DEVICE_A = "40000000-0000-0000-0000-000000000001"; // driver.a 차량
const DEVICE_B = "40000000-0000-0000-0000-000000000002"; // driver.b 차량
const DEVICE_C = "40000000-0000-0000-0000-000000000003"; // 서울 driver.c 차량
const DRIVER_A = { id: "20000000-0000-0000-0000-000000000003", role: "driver", orgId: ORG.hwaseong } as const;
const HWASEONG_ADMIN = { id: "20000000-0000-0000-0000-000000000002", role: "org_admin", orgId: ORG.hwaseong } as const;
const INVESTIGATOR = { id: "20000000-0000-0000-0000-000000000005", role: "investigator", orgId: ORG.hwaseong } as const;

const payload = (deviceId: string) => ({
  deviceId,
  accelCalibMin: 8050,
  accelCalibMax: 12050,
  brakeCalibMin: 9500,
  brakeCalibMax: 13000,
});

afterAll(async () => {
  await adminClient()
    .from("devices")
    .update({ accel_calib_min: 0, accel_calib_max: 4095, brake_calib_min: 0, brake_calib_max: 4095 })
    .in("id", [DEVICE_A, DEVICE_B, DEVICE_C]);
});

describe("보정값 저장 권한", () => {
  it("driver 는 본인 배정 차량 단말의 보정값을 저장할 수 있다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    expect(await updateDeviceCalibration(driver, DRIVER_A, payload(DEVICE_A))).toEqual({ success: true });

    const { data } = await adminClient()
      .from("devices")
      .select("accel_calib_min, accel_calib_max, brake_calib_min, brake_calib_max")
      .eq("id", DEVICE_A)
      .single();
    expect(data).toEqual({ accel_calib_min: 8050, accel_calib_max: 12050, brake_calib_min: 9500, brake_calib_max: 13000 });
  });

  it("driver 는 같은 조직 다른 운전자·타 조직 단말을 바꿀 수 없다(403)", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    expect(await updateDeviceCalibration(driver, DRIVER_A, payload(DEVICE_B))).toMatchObject({ success: false, status: 403 });
    expect(await updateDeviceCalibration(driver, DRIVER_A, payload(DEVICE_C))).toMatchObject({ success: false, status: 403 });

    // 서버 검사를 건너뛰고 직접 UPDATE 해도 RLS 가 막는다(0건)
    const direct = await driver.from("devices").update({ accel_calib_min: 1000 }).eq("id", DEVICE_B).select("id");
    expect(direct.data).toEqual([]);
  });

  it("driver 는 보정값 외 컬럼(차량 연결·일련번호)을 바꿀 수 없다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const unbind = await driver.from("devices").update({ vehicle_id: null }).eq("id", DEVICE_A);
    expect(unbind.error?.code).toBe("42501");
    const serial = await driver.from("devices").update({ serial_number: "HACK" }).eq("id", DEVICE_A);
    expect(serial.error?.code).toBe("42501");
  });

  it("org_admin 은 소속 조직 단말만, investigator 는 저장 불가", async () => {
    const admin = await signedInClient("admin.hwaseong@pedaleye.test");
    expect(await updateDeviceCalibration(admin, HWASEONG_ADMIN, payload(DEVICE_B))).toEqual({ success: true });
    expect(await updateDeviceCalibration(admin, HWASEONG_ADMIN, payload(DEVICE_C))).toMatchObject({ success: false, status: 403 });

    const investigator = await signedInClient("investigator.hwaseong@pedaleye.test");
    expect(await updateDeviceCalibration(investigator, INVESTIGATOR, payload(DEVICE_A))).toMatchObject({ success: false, status: 403 });
  });

  it("가동 범위 5mm 미만은 400 으로 거부되고, DB 제약도 막는다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const result = await updateDeviceCalibration(driver, DRIVER_A, { ...payload(DEVICE_A), accelCalibMin: 11700 });
    expect(result).toEqual({ success: false, status: 400, error: "가속 페달 가동 범위가 너무 작습니다(최소 5mm 이상 필요)." });

    const direct = await driver.from("devices").update({ brake_calib_min: 12800 }).eq("id", DEVICE_A);
    expect(direct.error?.code).toBe("23514");
  });
});

describe("보정 정보 조회 범위", () => {
  it("driver 는 deviceId 없이 본인 단말을 받고, 타인 단말 ID 는 null", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    expect((await getDeviceCalibrationProjection(driver, DRIVER_A))?.deviceId).toBe(DEVICE_A);
    expect(await getDeviceCalibrationProjection(driver, DRIVER_A, DEVICE_C)).toBeNull();
  });
});
