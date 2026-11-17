import { afterAll, describe, expect, it } from "vitest";

import { PUBLIC_KEY_FORMAT_ERROR, normalizePublicKey, registerDevice, setDevicePublicKey } from "@/lib/devices/operations";

import { DEVICE, ORG, adminClient, signedInClient } from "./helpers";

// 단말 인증 공개키(docs/ble-protocol.md 4장): 슈퍼 관리자만 등록·교체·해제, 운전자는 자기 단말 키만 조회
const SUPER = { role: "super_admin", orgId: null } as const;
const HWASEONG_ADMIN = { role: "org_admin", orgId: ORG.hwaseong } as const;
const TEST_KEY_HEX = "046e71ee781208703e6b30826498adf9976fc4ab2cfc2772a56fdcbf40125656"; // 시험 벡터 공개키
const TEST_KEY_B64 = "BG5x7ngSCHA+azCCZJit+ZdvxKss/CdypW/cv0ASVlY=";
const OTHER_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const startedAt = new Date(Date.now() - 1000).toISOString();
const createdSerials: string[] = [];

afterAll(async () => {
  const admin = adminClient();
  await admin.from("devices").update({ auth_public_key: TEST_KEY_B64 }).eq("id", DEVICE.driverA);
  if (createdSerials.length) await admin.from("devices").delete().in("serial_number", createdSerials);
});

describe("공개키 형식", () => {
  it("Hex 64자·Base64 44자를 표준 Base64 로 바꾸고, 그 밖은 거부한다", () => {
    expect(normalizePublicKey(TEST_KEY_HEX)).toBe(TEST_KEY_B64);
    expect(normalizePublicKey(` ${TEST_KEY_B64} `)).toBe(TEST_KEY_B64);
    expect(normalizePublicKey("")).toBeNull();
    for (const bad of ["abc", TEST_KEY_HEX.slice(2), `${TEST_KEY_B64.slice(0, -2)}Z=`, Buffer.alloc(33).toString("base64"), "z".repeat(64)]) {
      expect(normalizePublicKey(bad), bad).toBeUndefined();
    }
  });

  it("DB 제약도 잘못된 형식을 막는다(서비스 키 포함)", async () => {
    const { error } = await adminClient().from("devices").update({ auth_public_key: "not-a-key" }).eq("id", DEVICE.inventory);
    expect(error?.code).toBe("23514");
  });
});

describe("등록·교체·해제", () => {
  it("슈퍼 관리자는 등록 때 키를 넣고(Hex 도 가능), 형식 오류를 안내받는다", async () => {
    const client = await signedInClient("super@pedaleye.test");
    const serial = `PE-2098-${String(Date.now()).slice(-6)}`;
    createdSerials.push(serial);
    expect(await registerDevice(client, SUPER, { org_id: ORG.hwaseong, serial_number: serial, auth_public_key: "1234" })).toEqual({ ok: false, error: PUBLIC_KEY_FORMAT_ERROR });
    expect((await registerDevice(client, SUPER, { org_id: ORG.hwaseong, serial_number: serial, auth_public_key: TEST_KEY_HEX })).ok).toBe(true);
    const { data } = await adminClient().from("devices").select("auth_public_key").eq("serial_number", serial).single();
    expect(data?.auth_public_key).toBe(TEST_KEY_B64);
  });

  it("교체·해제는 사유와 함께 감사 로그에 남고, 사유가 없으면 거부된다", async () => {
    const client = await signedInClient("super@pedaleye.test");
    expect(await setDevicePublicKey(client, SUPER, { deviceId: DEVICE.driverA, publicKey: OTHER_KEY_B64, reason: "" })).toEqual({
      ok: false,
      error: "교체·해제 사유를 입력해 주세요(감사 로그에 기록).",
    });
    expect(await setDevicePublicKey(client, SUPER, { deviceId: DEVICE.driverA, publicKey: OTHER_KEY_B64, reason: "단말 재생산" })).toEqual({ ok: true, data: { changed: true } });
    expect(await setDevicePublicKey(client, SUPER, { deviceId: DEVICE.driverA, publicKey: "", reason: "시험 전환" })).toEqual({ ok: true, data: { changed: true } });
    expect(await setDevicePublicKey(client, SUPER, { deviceId: DEVICE.driverA, publicKey: TEST_KEY_HEX, reason: "원복" })).toEqual({ ok: true, data: { changed: true } });

    const { data: logs } = await adminClient()
      .from("audit_logs")
      .select("action_type, actor_role, changes_summary")
      .eq("target_id", DEVICE.driverA)
      .in("action_type", ["DEVICE_KEY_REGISTER", "DEVICE_KEY_UPDATE", "DEVICE_KEY_REVOKE"])
      .gte("created_at", startedAt)
      .order("created_at");
    expect(logs?.map((l) => l.action_type)).toEqual(["DEVICE_KEY_UPDATE", "DEVICE_KEY_REVOKE", "DEVICE_KEY_REGISTER"]);
    expect(logs?.[0]).toMatchObject({ actor_role: "super_admin", changes_summary: { reason: "단말 재생산", before: { auth_public_key: TEST_KEY_B64 }, after: { auth_public_key: OTHER_KEY_B64 } } });
  });

  it("조직 관리자·운전자는 키를 바꿀 수 없다(서버·DB)", async () => {
    const hw = await signedInClient("admin.hwaseong@pedaleye.test");
    expect((await setDevicePublicKey(hw, HWASEONG_ADMIN, { deviceId: DEVICE.driverA, publicKey: OTHER_KEY_B64, reason: "x" })).ok).toBe(false);
    expect((await hw.rpc("set_device_public_key", { p_device_id: DEVICE.driverA, p_public_key: OTHER_KEY_B64, p_reason: "우회" })).error?.code).toBe("42501");
    expect((await hw.from("devices").update({ auth_public_key: OTHER_KEY_B64 }).eq("id", DEVICE.driverA)).error?.code).toBe("42501");
    const driver = await signedInClient("driver.a@pedaleye.test");
    expect((await driver.from("devices").update({ auth_public_key: OTHER_KEY_B64 }).eq("id", DEVICE.driverA)).error?.code).toBe("42501");
  });
});

describe("조회 범위", () => {
  it("운전자는 자기 배정 차량 단말의 일련번호·공개키만 본다", async () => {
    const driver = await signedInClient("driver.a@pedaleye.test");
    const { data } = await driver.from("devices").select("id, serial_number, auth_public_key");
    expect(data).toEqual([{ id: DEVICE.driverA, serial_number: "PE-2026-000001", auth_public_key: TEST_KEY_B64 }]);
    const other = await signedInClient("driver.c@pedaleye.test");
    const { data: c } = await other.from("devices").select("id").eq("id", DEVICE.driverA);
    expect(c).toEqual([]);
  });
});
