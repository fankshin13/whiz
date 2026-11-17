import { afterAll, describe, expect, it } from "vitest";

import { listCalibrationTargets } from "@/lib/calibration/operations";
import { SERIAL_DUPLICATE_ERROR, SERIAL_FORMAT_ERROR, listDevices, mountDevice, registerDevice, unmountDevice } from "@/lib/devices/operations";

import { DEVICE, ORG, USER, VEHICLE, adminClient, signedInClient } from "./helpers";

// 단말 재고는 조직별(결정 2026-11-17): 슈퍼 관리자가 조직을 정해 등록, 조직 관리자는 자기 조직 재고·차량만.
const SUPER = { role: "super_admin", orgId: null } as const;
const HWASEONG_ADMIN = { role: "org_admin", orgId: ORG.hwaseong } as const;
const SEOUL_ADMIN = { role: "org_admin", orgId: ORG.seoul } as const;
const DRIVER_A = { id: USER.driverA, role: "driver", orgId: ORG.hwaseong } as const;

const serial = (n: number) => `PE-2099-${String(Date.now()).slice(-5)}${n}`;
const createdSerials: string[] = [];
const CALIB = ["accel_calib_min", "accel_calib_max", "brake_calib_min", "brake_calib_max"] as const;

afterAll(async () => {
  const admin = adminClient();
  if (createdSerials.length) await admin.from("devices").delete().in("serial_number", createdSerials);
  // 장착 상태 복구(seed 기준)
  await admin.from("devices").update({ vehicle_id: null }).eq("id", DEVICE.inventory);
  await admin.from("devices").update({ vehicle_id: VEHICLE.driverA, org_id: ORG.hwaseong }).eq("id", DEVICE.driverA);
});

describe("단말 등록", () => {
  it("슈퍼 관리자는 조직을 정해 재고로 등록하고, 형식·중복 오류를 안내한다", async () => {
    const client = await signedInClient("super@pedaleye.test");
    const sn = serial(1);
    createdSerials.push(sn);
    const created = await registerDevice(client, SUPER, { org_id: ORG.seoul, serial_number: ` ${sn.toLowerCase()} `, mac_address: "aa-bb-cc-dd-ee-01", hardware_rev: "", firmware_version: "" });
    expect(created).toMatchObject({ ok: true, data: { serialNumber: sn } });

    const { data } = await adminClient().from("devices").select("org_id, vehicle_id, mac_address, hardware_rev, firmware_version").eq("serial_number", sn).single();
    expect(data).toEqual({ org_id: ORG.seoul, vehicle_id: null, mac_address: "AA:BB:CC:DD:EE:01", hardware_rev: "v1.0", firmware_version: "1.0.0" });

    expect(await registerDevice(client, SUPER, { org_id: ORG.seoul, serial_number: sn })).toEqual({ ok: false, error: SERIAL_DUPLICATE_ERROR });
    for (const bad of ["PE-26-000001", "PE-2026-00001", "XX-2026-000001", ""]) {
      expect(await registerDevice(client, SUPER, { org_id: ORG.seoul, serial_number: bad }), bad).toEqual({ ok: false, error: SERIAL_FORMAT_ERROR });
    }
    expect((await registerDevice(client, SUPER, { org_id: ORG.seoul, serial_number: serial(2), mac_address: "AA:BB" })).ok).toBe(false);
  });

  it("조직 관리자는 등록할 수 없다(서버 확인 + RLS)", async () => {
    const client = await signedInClient("admin.hwaseong@pedaleye.test");
    expect(await registerDevice(client, HWASEONG_ADMIN, { org_id: ORG.hwaseong, serial_number: serial(3) })).toEqual({ ok: false, error: "이 작업을 수행할 권한이 없습니다." });
    const direct = await client.from("devices").insert({ serial_number: serial(4), org_id: ORG.hwaseong });
    expect(direct.error?.code).toBe("42501");
  });
});

describe("조직별 재고 범위", () => {
  it("조직 관리자는 자기 조직 단말(장착+재고)만 본다", async () => {
    const hw = await listDevices(await signedInClient("admin.hwaseong@pedaleye.test"), HWASEONG_ADMIN);
    expect(hw.map((d) => d.id)).toEqual([DEVICE.driverA, DEVICE.driverB, DEVICE.inventory]);
    const seoul = await listDevices(await signedInClient("admin.seoul@pedaleye.test"), SEOUL_ADMIN);
    expect(seoul.every((d) => d.orgId === ORG.seoul)).toBe(true);
    expect(seoul.map((d) => d.id)).toContain(DEVICE.driverC);
    expect(seoul.map((d) => d.id)).not.toContain(DEVICE.inventory);
  });

  it("다른 조직 재고를 자기 차량에, 자기 재고를 다른 조직 차량에 장착할 수 없다", async () => {
    const seoul = await signedInClient("admin.seoul@pedaleye.test");
    expect(await mountDevice(seoul, SEOUL_ADMIN, { deviceId: DEVICE.inventory, vehicleId: VEHICLE.driverC, replace: true })).toEqual({
      ok: false,
      error: "단말을 찾을 수 없거나 관리 권한이 없습니다.",
    });
    const hw = await signedInClient("admin.hwaseong@pedaleye.test");
    expect(await mountDevice(hw, HWASEONG_ADMIN, { deviceId: DEVICE.inventory, vehicleId: VEHICLE.driverC, replace: true })).toEqual({
      ok: false,
      error: "차량을 찾을 수 없거나 관리 권한이 없습니다.",
    });
    // 다른 조직 단말 해제·조직 변경도 막힌다
    expect((await unmountDevice(seoul, SEOUL_ADMIN, DEVICE.driverA)).ok).toBe(false);
    const moveOrg = await hw.from("devices").update({ org_id: ORG.seoul }).eq("id", DEVICE.inventory);
    expect(moveOrg.error?.code).toBe("42501");
  });

  it("운전자는 장착 함수를 부를 수 없다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const { error } = await driver.rpc("mount_device", { p_device_id: DEVICE.inventory, p_vehicle_id: VEHICLE.driverA, p_replace: true });
    expect(error?.code).toBe("42501");
  });
});

describe("교체·해제", () => {
  it("교체는 동의해야 하고, 기존 단말은 그 조직 재고로, 새 단말은 보정 필요 상태로 운전자에게 연결된다", async () => {
    const admin = adminClient();
    // 새 단말이 이전 보정값을 가져오지 않는지 보려고 재고 단말에 임의 보정값을 넣어 둔다
    await admin.from("devices").update({ accel_calib_min: 1000, accel_calib_max: 3000, brake_calib_min: 1000, brake_calib_max: 3000 }).eq("id", DEVICE.inventory);
    const hw = await signedInClient("admin.hwaseong@pedaleye.test");

    expect(await mountDevice(hw, HWASEONG_ADMIN, { deviceId: DEVICE.inventory, vehicleId: VEHICLE.driverA })).toEqual({
      ok: false,
      error: "이 차량에는 이미 다른 단말이 장착되어 있습니다. 교체하려면 교체에 동의해 주세요.",
    });

    const replaced = await mountDevice(hw, HWASEONG_ADMIN, { deviceId: DEVICE.inventory, vehicleId: VEHICLE.driverA, replace: true });
    expect(replaced).toEqual({ ok: true, data: { deviceId: DEVICE.inventory, replacedSerial: "PE-2026-000001" } });

    const { data: rows } = await admin.from("devices").select(`id, vehicle_id, org_id, ${CALIB.join(", ")}`).in("id", [DEVICE.driverA, DEVICE.inventory]).order("id");
    expect(rows?.[0]).toMatchObject({ id: DEVICE.driverA, vehicle_id: null, org_id: ORG.hwaseong });
    expect(rows?.[1]).toMatchObject({ id: DEVICE.inventory, vehicle_id: VEHICLE.driverA, accel_calib_min: 0, accel_calib_max: 4095, brake_calib_min: 0, brake_calib_max: 4095 });

    const list = await listDevices(hw, HWASEONG_ADMIN);
    expect(list.find((d) => d.id === DEVICE.inventory)).toMatchObject({ needsCalibration: true, vehicle: { id: VEHICLE.driverA } });

    // 운전자 앱 보정 대상이 새 단말로 바뀐다
    const targets = await listCalibrationTargets(await signedInClient("driver.a@pedaleye.test"), DRIVER_A);
    expect(targets.map((t) => t.deviceId)).toEqual([DEVICE.inventory]);

    // 해제하면 재고로 돌아가고, 같은 단말을 다시 해제하면 안내한다
    expect(await unmountDevice(hw, HWASEONG_ADMIN, DEVICE.inventory)).toEqual({ ok: true, data: null });
    expect((await unmountDevice(hw, HWASEONG_ADMIN, DEVICE.inventory)).ok).toBe(false);
    expect(await mountDevice(hw, HWASEONG_ADMIN, { deviceId: DEVICE.driverA, vehicleId: VEHICLE.driverA })).toMatchObject({ ok: true });
  });

  it("슈퍼 관리자가 조직 미지정 단말을 장착하면 그 차량 조직의 단말이 된다", async () => {
    const sn = serial(5);
    createdSerials.push(sn);
    const admin = adminClient();
    const { data: device } = await admin.from("devices").insert({ serial_number: sn }).select("id").single();
    const superClient = await signedInClient("super@pedaleye.test");
    // 미배정 차량(화성)에 장착 → 화성 소속
    expect((await mountDevice(superClient, SUPER, { deviceId: device?.id, vehicleId: VEHICLE.unassigned })).ok).toBe(true);
    const { data } = await admin.from("devices").select("org_id").eq("serial_number", sn).single();
    expect(data?.org_id).toBe(ORG.hwaseong);
    expect((await unmountDevice(superClient, SUPER, device?.id)).ok).toBe(true);
  });
});
