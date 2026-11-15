import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";

import { ORG, PASSWORD, USER, VEHICLE, anonClient, signedInClient } from "./helpers";

type Client = SupabaseClient<Database>;
const clients: Record<string, Client> = {};

beforeAll(async () => {
  for (const [key, email] of Object.entries({
    superAdmin: "super@pedaleye.test",
    hwaseongAdmin: "admin.hwaseong@pedaleye.test",
    driverA: "driver.a@pedaleye.test",
    investigator: "investigator.hwaseong@pedaleye.test",
    seoulAdmin: "admin.seoul@pedaleye.test",
  })) {
    clients[key] = await signedInClient(email);
  }
});

function c(key: string): Client {
  const client = clients[key];
  if (!client) throw new Error(`client ${key} missing`);
  return client;
}

async function ids(client: Client, table: "vehicles" | "devices" | "event_sessions" | "organizations") {
  const { data, error } = await client.from(table).select("id");
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.map((row) => row.id).sort();
}

describe("인증", () => {
  it("틀린 비밀번호는 invalid_credentials 로 거부된다", async () => {
    const { data, error } = await anonClient().auth.signInWithPassword({
      email: "driver.a@pedaleye.test",
      password: "wrong-password-123",
    });
    expect(error?.code).toBe("invalid_credentials");
    expect(data.session).toBeNull();
  });

  it("신규 가입자는 메타데이터와 무관하게 driver·조직 없음으로 시작한다", async () => {
    const client = anonClient();
    const email = `new-${Date.now()}@pedaleye.test`;
    const { data, error } = await client.auth.signUp({
      email,
      password: PASSWORD,
      options: { data: { name: "신규", role: "super_admin", org_id: ORG.seoul } },
    });
    expect(error).toBeNull();
    const { data: profile } = await client.from("users").select("role, org_id").eq("id", data.user?.id ?? "").single();
    expect(profile).toEqual({ role: "driver", org_id: null });
    expect(await ids(client, "vehicles")).toEqual([]);
  });
});

describe("익명 사용자", () => {
  it("모든 테이블 접근이 거부된다", async () => {
    for (const table of ["organizations", "users", "vehicles", "devices", "event_sessions"] as const) {
      const { error } = await anonClient().from(table).select("id");
      expect(error?.code, table).toBe("42501");
    }
  });
});

describe("역할별 조회 격리 (RLS)", () => {
  it("driver 는 배정된 본인 차량·단말·이벤트만 본다", async () => {
    expect(await ids(c("driverA"), "vehicles")).toEqual([VEHICLE.driverA]);
    expect(await ids(c("driverA"), "devices")).toEqual(["40000000-0000-0000-0000-000000000001"]);
    expect(await ids(c("driverA"), "event_sessions")).toEqual(["50000000-0000-0000-0000-000000000001"]);

    const { data } = await c("driverA").from("vehicles").select("id").in("id", [VEHICLE.driverB, VEHICLE.driverC]);
    expect(data).toEqual([]);
  });

  it("org_admin 은 소속 조직 차량·단말(+미장착 재고)만 본다", async () => {
    expect(await ids(c("hwaseongAdmin"), "vehicles")).toEqual([VEHICLE.driverA, VEHICLE.driverB]);
    expect(await ids(c("hwaseongAdmin"), "devices")).toEqual([
      "40000000-0000-0000-0000-000000000001",
      "40000000-0000-0000-0000-000000000002",
      "40000000-0000-0000-0000-000000000004",
    ]);
    expect(await ids(c("seoulAdmin"), "vehicles")).toEqual([VEHICLE.driverC]);
    expect(await ids(c("seoulAdmin"), "organizations")).toEqual([ORG.seoul]);
  });

  it("investigator 는 소속 조직의 이벤트만 보고, 사용자 목록은 본인만 본다", async () => {
    expect(await ids(c("investigator"), "event_sessions")).toEqual(["50000000-0000-0000-0000-000000000001"]);
    const { data } = await c("investigator").from("users").select("id");
    expect(data).toHaveLength(1);
  });

  it("super_admin 은 모든 조직·차량·단말을 본다", async () => {
    expect(await ids(c("superAdmin"), "organizations")).toEqual([ORG.hwaseong, ORG.seoul]);
    expect(await ids(c("superAdmin"), "vehicles")).toEqual([VEHICLE.driverA, VEHICLE.driverB, VEHICLE.driverC]);
    expect((await ids(c("superAdmin"), "devices")).length).toBe(4);
  });
});

describe("쓰기 권한", () => {
  it("driver 는 자신의 역할·조직을 바꿀 수 없다", async () => {
    const { error } = await c("driverA").from("users").update({ role: "super_admin" }).eq("id", USER.driverA);
    expect(error?.code).toBe("42501");
  });

  it("driver 는 차량을 만들 수 없다", async () => {
    const { error } = await c("driverA")
      .from("vehicles")
      .insert({ org_id: ORG.hwaseong, plate_number: "99하 9999", model_name: "테스트" });
    expect(error?.code).toBe("42501");
  });

  it("org_admin 은 다른 조직에 차량을 만들거나 다른 조직 차량을 수정할 수 없다", async () => {
    const insert = await c("hwaseongAdmin")
      .from("vehicles")
      .insert({ org_id: ORG.seoul, plate_number: "99하 9999", model_name: "테스트" });
    expect(insert.error?.code).toBe("42501");

    const update = await c("hwaseongAdmin")
      .from("vehicles")
      .update({ model_name: "변조" })
      .eq("id", VEHICLE.driverC)
      .select();
    expect(update.data).toEqual([]);
  });

  it("이벤트 증거 기록은 수정·삭제할 수 없다", async () => {
    const update = await c("superAdmin")
      .from("event_sessions")
      .update({ integrity_verified: true })
      .eq("id", "50000000-0000-0000-0000-000000000001");
    expect(update.error?.code).toBe("42501");
    const del = await c("superAdmin").from("event_sessions").delete().eq("id", "50000000-0000-0000-0000-000000000001");
    expect(del.error?.code).toBe("42501");
  });

  it("driver 는 다른 사람 차량 단말로 이벤트를 올릴 수 없다", async () => {
    const { error } = await c("driverA").from("event_sessions").insert({
      device_id: "40000000-0000-0000-0000-000000000002",
      trigger_type: "manual",
      start_time: "2026-11-15T10:00:00+09:00",
      end_time: "2026-11-15T10:01:00+09:00",
      initial_chain_hash: "0".repeat(64),
      final_chain_hash: "c".repeat(64),
    });
    expect(error?.code).toBe("42501");
  });
});

describe("시각", () => {
  it("timestamptz 가 Asia/Seoul(+09:00) 기준으로 반환된다", async () => {
    const { data } = await c("driverA")
      .from("event_sessions")
      .select("start_time")
      .eq("id", "50000000-0000-0000-0000-000000000001")
      .single();
    expect(data?.start_time).toBe("2026-11-10T08:15:00+09:00");
  });
});
