import { afterAll, describe, expect, it } from "vitest";

import { PLATE_DUPLICATE_ERROR, PLATE_FORMAT_ERROR, unassignDriver, upsertVehicle } from "@/lib/vehicles/operations";

import { ORG, USER, VEHICLE, adminClient, signedInClient } from "./helpers";

const SUPER = { role: "super_admin", orgId: null } as const;
const HWASEONG_ADMIN = { role: "org_admin", orgId: ORG.hwaseong } as const;
const SEOUL_ADMIN = { role: "org_admin", orgId: ORG.seoul } as const;
const DRIVER = { role: "driver", orgId: ORG.hwaseong } as const;

const created: string[] = [];
const plate = (n: number) => `${70 + n}허 ${String(Date.now()).slice(-4)}`;

afterAll(async () => {
  const admin = adminClient();
  if (created.length) await admin.from("vehicles").delete().in("id", created);
  // 해제 시험으로 끊은 배정 복구
  await admin.from("vehicles").update({ assigned_user_id: USER.driverB }).eq("id", VEHICLE.driverB);
});

describe("차량 등록·수정", () => {
  it("슈퍼 관리자는 고른 조직에, 조직 관리자는 요청과 무관하게 자기 조직에 등록한다", async () => {
    const superClient = await signedInClient("super@pedaleye.test");
    const bySuper = await upsertVehicle(superClient, SUPER, { org_id: ORG.seoul, plate_number: plate(1), model_name: "봉고3", model_year: "2023", vin_masked: " KMH*1111 " });
    expect(bySuper.ok).toBe(true);
    if (!bySuper.ok) return;
    created.push(bySuper.data.id);
    expect(bySuper.data).toMatchObject({ org_id: ORG.seoul, model_year: 2023, vin_masked: "KMH*1111" });

    const adminHw = await signedInClient("admin.hwaseong@pedaleye.test");
    const byOrgAdmin = await upsertVehicle(adminHw, HWASEONG_ADMIN, { org_id: ORG.seoul, plate_number: plate(2), model_name: "포터2" });
    expect(byOrgAdmin.ok && byOrgAdmin.data.org_id).toBe(ORG.hwaseong);
    if (byOrgAdmin.ok) created.push(byOrgAdmin.data.id);
  });

  it("번호판 형식·연식 범위 오류를 안내한다", async () => {
    const client = await signedInClient("admin.hwaseong@pedaleye.test");
    for (const bad of ["1234", "가나다", "12가 345", "AB 1234"]) {
      expect(await upsertVehicle(client, HWASEONG_ADMIN, { plate_number: bad, model_name: "x" }), bad).toEqual({ ok: false, error: PLATE_FORMAT_ERROR });
    }
    expect(await upsertVehicle(client, HWASEONG_ADMIN, { plate_number: plate(3), model_name: "x", model_year: 1970 })).toEqual({
      ok: false,
      error: "연식은 1980년 이후로 입력해 주세요.",
    });
    expect((await upsertVehicle(client, HWASEONG_ADMIN, { plate_number: plate(3), model_name: "x", model_year: new Date().getFullYear() + 2 })).ok).toBe(false);
  });

  it("다른 조직에 있는 같은 번호(띄어쓰기만 달라도)는 중복으로 막는다", async () => {
    // 서울 관리자는 화성 차량 '12가 3456' 을 볼 수 없지만 DB 고유 인덱스가 막는다
    const seoul = await signedInClient("admin.seoul@pedaleye.test");
    expect(await upsertVehicle(seoul, SEOUL_ADMIN, { plate_number: "12가3456", model_name: "아반떼" })).toEqual({ ok: false, error: PLATE_DUPLICATE_ERROR });
    expect(await upsertVehicle(seoul, SEOUL_ADMIN, { plate_number: "12가  3456", model_name: "아반떼" })).toEqual({ ok: false, error: PLATE_DUPLICATE_ERROR });
  });

  it("조직 관리자는 다른 조직 차량을 수정할 수 없고, 수정해도 소속 조직은 바뀌지 않는다", async () => {
    const seoul = await signedInClient("admin.seoul@pedaleye.test");
    const denied = await upsertVehicle(seoul, SEOUL_ADMIN, { id: VEHICLE.driverA, plate_number: "12가 3456", model_name: "변조" });
    expect(denied.ok).toBe(false);

    const superClient = await signedInClient("super@pedaleye.test");
    const moved = await upsertVehicle(superClient, SUPER, { id: VEHICLE.driverA, org_id: ORG.seoul, plate_number: "12가 3456", model_name: "아반떼", model_year: 2021 });
    expect(moved.ok && moved.data.org_id).toBe(ORG.hwaseong);

    const { data } = await adminClient().from("vehicles").select("model_name, org_id").eq("id", VEHICLE.driverA).single();
    expect(data).toEqual({ model_name: "아반떼", org_id: ORG.hwaseong });
  });
});

describe("배정 운전자 해제", () => {
  it("조직 관리자가 해제하면 그 운전자는 차량·단말·사고 기록을 더 보지 않는다", async () => {
    const driverB = await signedInClient("driver.b@pedaleye.test");
    expect((await driverB.from("vehicles").select("id")).data).toHaveLength(1);

    // 다른 조직 관리자·운전자는 해제할 수 없다
    const seoul = await signedInClient("admin.seoul@pedaleye.test");
    expect((await unassignDriver(seoul, SEOUL_ADMIN, VEHICLE.driverB)).ok).toBe(false);
    expect((await unassignDriver(driverB, DRIVER, VEHICLE.driverB)).ok).toBe(false);

    const adminHw = await signedInClient("admin.hwaseong@pedaleye.test");
    expect(await unassignDriver(adminHw, HWASEONG_ADMIN, VEHICLE.driverB)).toEqual({ ok: true, data: null });

    for (const table of ["vehicles", "devices", "event_sessions"] as const) {
      expect((await driverB.from(table).select("id")).data, table).toEqual([]);
    }
  });
});
