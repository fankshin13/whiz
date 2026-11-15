import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { CurrentUser } from "@/lib/auth/get-current-user";
import { listCalibrationTargets } from "@/lib/calibration/operations";
import type { Database } from "@/lib/supabase/database.types";
import { computeGenesisHash, toHex, verifyBinaryHashChain } from "@/lib/telemetry/hash-chain-engine";
import { HASH_SIZE, PACKET_SIZE, decodePacketRecord } from "@/lib/telemetry/packet-codec";

type Client = SupabaseClient<Database>;
type Operator = Pick<CurrentUser, "id" | "role" | "orgId">;

export const EVENT_LOG_BUCKET = "event-logs";
const MAX_RECORDS = 3000; // 50Hz × 60초
const MAX_BASE64_LENGTH = Math.ceil(((MAX_RECORDS * PACKET_SIZE + HASH_SIZE) * 4) / 3) + 4;
const TIME_TOLERANCE_MS = 1000;

export const uploadEventSessionSchema = z.object({
  deviceId: z.guid(),
  triggerType: z.enum(["shock", "sudden_accel", "manual", "periodic"]),
  startTime: z.iso.datetime({ offset: true }),
  endTime: z.iso.datetime({ offset: true }),
  rawLogBase64: z.base64().max(MAX_BASE64_LENGTH),
});

export type UploadSessionResult =
  | {
      success: true;
      sessionId: string;
      recordCount: number;
      initialHash: string;
      finalHash: string;
      integrityVerified: boolean;
      brokenSequenceId?: number;
      duplicate: boolean;
    }
  | { success: false; status: 400 | 403 | 500; error: string };

const FORBIDDEN = { success: false, status: 403, error: "이 단말의 사고 기록을 올릴 권한이 없습니다." } as const;
const FAILED = { success: false, status: 500, error: "사고 기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." } as const;

function seoulYearMonth(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(ms);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
}

/**
 * 사고 세션(.pel) 업로드.
 * 1) 호출자 권한(super_admin 전체 / org_admin 소속 조직 / driver 본인 배정 차량)을 사용자 클라이언트로 확인
 * 2) 서버가 해시 체인을 직접 전수 검증(단말 제네시스 포함)
 * 3) 검증 결과와 함께 service_role 로 저장 — 사용자는 integrity_verified 를 직접 쓸 수 없다
 */
export async function uploadEventSession(
  userClient: Client,
  admin: Client,
  user: Operator,
  input: unknown,
): Promise<UploadSessionResult> {
  const parsed = uploadEventSessionSchema.safeParse(input);
  if (!parsed.success) return { success: false, status: 400, error: "업로드 형식이 올바르지 않습니다." };
  const payload = parsed.data;

  if (user.role === "investigator") return FORBIDDEN;
  const targets = await listCalibrationTargets(userClient, user);
  if (!targets.some((target) => target.deviceId === payload.deviceId)) return FORBIDDEN;

  const bytes = new Uint8Array(Buffer.from(payload.rawLogBase64, "base64"));
  const body = bytes.length - HASH_SIZE;
  if (body <= 0 || body % PACKET_SIZE !== 0 || body / PACKET_SIZE > MAX_RECORDS) {
    return { success: false, status: 400, error: "로그 파일 길이가 64바이트 패킷 규격과 맞지 않습니다." };
  }
  const recordCount = body / PACKET_SIZE;
  const firstMs = decodePacketRecord(bytes, 0).timestampMs;
  const lastMs = decodePacketRecord(bytes, (recordCount - 1) * PACKET_SIZE).timestampMs;
  if (
    Math.abs(Date.parse(payload.startTime) - firstMs) > TIME_TOLERANCE_MS ||
    Math.abs(Date.parse(payload.endTime) - lastMs) > TIME_TOLERANCE_MS
  ) {
    return { success: false, status: 400, error: "세션 시작·종료 시각이 로그 내용과 다릅니다." };
  }

  const genesis = toHex(await computeGenesisHash(payload.deviceId, firstMs));
  const verification = await verifyBinaryHashChain(bytes, { expectedInitialHash: genesis });
  const initialHash = toHex(bytes.subarray(32, 64));
  const finalHash = verification.finalHash || toHex(bytes.subarray(body));
  const startTime = new Date(firstMs).toISOString();

  const result = (sessionId: string, duplicate: boolean): UploadSessionResult => ({
    success: true,
    sessionId,
    recordCount,
    initialHash,
    finalHash,
    integrityVerified: verification.isValid,
    brokenSequenceId: verification.brokenSequenceId,
    duplicate,
  });

  const findExisting = async () => {
    const { data, error } = await admin
      .from("event_sessions")
      .select("id")
      .eq("device_id", payload.deviceId)
      .eq("start_time", startTime)
      .eq("final_chain_hash", finalHash)
      .eq("integrity_verified", true)
      .maybeSingle();
    if (error) throw new Error(`기존 세션 조회 실패 (${error.code})`);
    return data;
  };

  // 검증 통과 세션만 중복 판정. 변조·손상 파일은 매번 따로 남긴다.
  if (verification.isValid) {
    const existing = await findExisting();
    if (existing) return result(existing.id, true);
  }

  const sessionId = crypto.randomUUID();
  const path = `raw_logs/${payload.deviceId}/${seoulYearMonth(firstMs)}/${sessionId}.pel`;
  const { error: storageError } = await admin.storage
    .from(EVENT_LOG_BUCKET)
    .upload(path, bytes, { contentType: "application/octet-stream", upsert: false });
  if (storageError) {
    console.error("uploadEventSession storage failed", { message: storageError.message });
    return FAILED;
  }

  const { error: insertError } = await admin.from("event_sessions").insert({
    id: sessionId,
    device_id: payload.deviceId,
    trigger_type: payload.triggerType,
    start_time: startTime,
    end_time: new Date(lastMs).toISOString(),
    record_count: recordCount,
    initial_chain_hash: initialHash,
    final_chain_hash: finalHash,
    integrity_verified: verification.isValid,
    raw_log_storage_path: path,
  });

  if (insertError) {
    const { error: removeError } = await admin.storage.from(EVENT_LOG_BUCKET).remove([path]);
    if (removeError) console.error("uploadEventSession cleanup failed", { message: removeError.message });
    if (insertError.code === "23505" && verification.isValid) {
      const raced = await findExisting();
      if (raced) return result(raced.id, true);
    }
    console.error("uploadEventSession insert failed", { code: insertError.code });
    return FAILED;
  }

  // 세션이 올라왔다는 것은 앱이 단말과 연결됐다는 뜻이므로 동기화 시각을 갱신한다(관제 '정상/주의' 판정 근거)
  const { error: syncError } = await admin
    .from("devices")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", payload.deviceId);
  if (syncError) console.error("uploadEventSession last_synced_at update failed", { code: syncError.code });

  return result(sessionId, false);
}
