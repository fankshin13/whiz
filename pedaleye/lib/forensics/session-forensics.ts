import type { SupabaseClient } from "@supabase/supabase-js";

import type { CurrentUser } from "@/lib/auth/get-current-user";
import { EVENT_LOG_BUCKET } from "@/lib/events/upload";
import { parseAllPackets, verifyLogFileIntegrity } from "@/lib/forensics/integrity-engine";
import type { Database } from "@/lib/supabase/database.types";
import { genesisSubject } from "@/lib/events/device-seal";
import { computeGenesisHash, toHex } from "@/lib/telemetry/hash-chain-engine";
import { decodePacketRecord } from "@/lib/telemetry/packet-codec";
import type { SessionForensicData } from "@/types/forensics";

type Client = SupabaseClient<Database>;
type Operator = Pick<CurrentUser, "role" | "orgId"> & { id?: string };

export const SESSION_NOT_AVAILABLE = "사고 세션 데이터를 찾을 수 없거나 열람 권한이 없습니다.";

export type SessionForensicsResult =
  | { success: true; data: SessionForensicData; storedVerified: boolean }
  | { success: false; status: 403 | 404 | 422 | 500; error: string };

/**
 * 저장된 세션의 원본 로그를 받아 다시 전수 검증한다.
 * 권한: super_admin 전체, org_admin·investigator 는 소속 조직 차량 세션만,
 * driver 는 지금 본인에게 배정된 차량의 세션만(RLS 로 한 번 더 제한).
 * syncWith 를 주면 검증 결과가 저장값과 다를 때 service_role 로 integrity_verified 를 맞춘다.
 */
export async function loadSessionForensics(
  userClient: Client,
  user: Operator,
  sessionId: string,
  syncWith?: Client,
): Promise<SessionForensicsResult> {
  if (!["super_admin", "org_admin", "investigator", "driver"].includes(user.role)) {
    return { success: false, status: 403, error: SESSION_NOT_AVAILABLE };
  }
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return { success: false, status: 404, error: SESSION_NOT_AVAILABLE };

  const { data: session, error } = await userClient
    .from("event_sessions")
    .select(
      "id, device_id, trigger_type, start_time, end_time, integrity_verified, raw_log_storage_path, device_seal_signature, device_seal_verified, device:devices!inner(serial_number, vehicle:vehicles!inner(plate_number, org_id, assigned_user_id))",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (error) {
    console.error("loadSessionForensics query failed", { code: error.code });
    return { success: false, status: 500, error: "세션 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  const inScope =
    !!session &&
    (user.role === "super_admin" ||
      (user.role === "driver"
        ? !!user.id && session.device.vehicle.assigned_user_id === user.id
        : session.device.vehicle.org_id === user.orgId));
  if (!session || !inScope) {
    return { success: false, status: 403, error: SESSION_NOT_AVAILABLE };
  }
  if (!session.raw_log_storage_path) {
    return { success: false, status: 422, error: "이 세션에는 원본 로그 파일이 없어 해시 체인을 검증할 수 없습니다." };
  }

  const download = await userClient.storage.from(EVENT_LOG_BUCKET).download(session.raw_log_storage_path);
  if (download.error || !download.data) {
    console.error("loadSessionForensics download failed", { message: download.error?.message });
    return { success: false, status: 500, error: "원본 로그 파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  const bytes = new Uint8Array(await download.data.arrayBuffer());

  let genesis: string | undefined;
  // 단말이 봉인한 기록은 일련번호, 앱이 만든 기록은 단말 ID 로 체인 시작값을 계산한다
  const sealed = session.device_seal_signature !== null;
  const subject = genesisSubject({ deviceId: session.device_id, serial: session.device.serial_number, sealed });
  if (bytes.length >= 64) genesis = toHex(await computeGenesisHash(subject, decodePacketRecord(bytes, 0).timestampMs));
  const chain = await verifyLogFileIntegrity(bytes, genesis);
  // 봉인 서명은 업로드 때 등록 공개키로 확인한 결과를 쓴다(이후 키 교체와 무관). 봉인이 틀린 기록은 통과로 보지 않는다
  const verification = sealed && !session.device_seal_verified && chain.isValid ? { ...chain, isValid: false } : chain;

  if (syncWith && verification.isValid !== session.integrity_verified) {
    const { error: updateError } = await syncWith
      .from("event_sessions")
      .update({ integrity_verified: verification.isValid })
      .eq("id", session.id);
    if (updateError) {
      console.error("loadSessionForensics sync failed", { code: updateError.code });
      return { success: false, status: 500, error: "검증 결과를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
  }

  return {
    success: true,
    storedVerified: session.integrity_verified,
    data: {
      sessionId: session.id,
      deviceId: session.device_id,
      deviceSerialNumber: session.device.serial_number,
      plateNumber: session.device.vehicle.plate_number,
      triggerType: session.trigger_type,
      startTime: session.start_time,
      endTime: session.end_time,
      verification,
      deviceSealed: sealed ? (session.device_seal_verified ? "verified" : "invalid") : "none",
      packets: await parseAllPackets(bytes),
    },
  };
}
