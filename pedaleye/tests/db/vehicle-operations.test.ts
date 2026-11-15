import { describe, expect, it } from "vitest";

import { bindDeviceToVehicle, upsertVehicle } from "@/lib/vehicles/operations";

import { ORG, USER, VEHICLE, signedInClient } from "./helpers";

const hwaseongAdmin = { role: "org_admin", orgId: ORG.hwaseong } as const;

describe("upsertVehicle / bindDeviceToVehicle", () => {
  it("org_admin 이 만든 차량은 요청과 무관하게 본인 조직에 들어가고, 재고 단말을 장착할 수 있다", async () => {
    const supabase = await signedInClient("admin.hwaseong@pedaleye.test");

    const created = await upsertVehicle(supabase, hwaseongAdmin, {
      org_id: ORG.seoul, // 무시되어야 함
      plate_number: "56다 7777",
      model_name: "캐스퍼",
      model_year: 2024,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.org_id).toBe(ORG.hwaseong);

    try {
      const bound = await bindDeviceToVehicle(supabase, hwaseongAdmin, {
        serial_number: "PE-2026-000004",
        vehicle_id: created.data.id,
      });
      expect(bound).toMatchObject({ ok: true, data: { vehicle_id: created.data.id } });

      const busy = await bindDeviceToVehicle(supabase, hwaseongAdmin, {
        serial_number: "PE-2026-000001",
        vehicle_id: created.data.id,
      });
      expect(busy).toEqual({ ok: false, error: "이미 다른 차량에 장착된 단말입니다." });
    } finally {
      // 차량 삭제 시 단말은 vehicle_id = null(재고)로 돌아간다
      const { error } = await supabase.from("vehicles").delete().eq("id", created.data.id);
      expect(error).toBeNull();
    }
  });

  it("다른 조직 운전자를 배정하거나 다른 조직 차량에 단말을 장착할 수 없다", async () => {
    const supabase = await signedInClient("admin.hwaseong@pedaleye.test");

    const crossAssign = await upsertVehicle(supabase, hwaseongAdmin, {
      plate_number: "56다 8888",
      model_name: "레이",
      assigned_user_id: USER.driverC,
    });
    expect(crossAssign).toEqual({ ok: false, error: "배정 운전자는 같은 조직 소속이어야 합니다." });

    const crossBind = await bindDeviceToVehicle(supabase, hwaseongAdmin, {
      serial_number: "PE-2026-000004",
      vehicle_id: VEHICLE.driverC,
    });
    expect(crossBind).toEqual({ ok: false, error: "차량을 찾을 수 없거나 관리 권한이 없습니다." });
  });

  it("driver 는 차량 관리 작업을 할 수 없다", async () => {
    const supabase = await signedInClient("driver.a@pedaleye.test");
    const result = await upsertVehicle(supabase, { role: "driver", orgId: ORG.hwaseong }, {
      plate_number: "56다 9999",
      model_name: "모닝",
    });
    expect(result).toEqual({ ok: false, error: "이 작업을 수행할 권한이 없습니다." });
  });
});
