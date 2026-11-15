/**
 * SHA-256(FIPS 180-4) 해시 체인. Web Crypto 를 써서 브라우저·Node·모바일 웹뷰 어디서나 같은 결과를 낸다.
 *
 *  H(-1) = SHA-256("PEDAL_EYE_GENESIS_" + deviceId + "_" + 첫 패킷 시각(ms))
 *  패킷 i 의 [32..63] = H(i-1),  H(i) = SHA-256(패킷 i 전체 64바이트 = 데이터 32B ‖ H(i-1))
 *
 * .pel 세션 파일 = 패킷 N개(64×N 바이트) + 끝에 Final_Chain_Hash(H(N-1), 32바이트).
 * 마지막 패킷은 뒤따르는 패킷이 없으므로 끝의 Final_Chain_Hash 로 변조를 잡는다.
 */
import {
  HASH_SIZE,
  PACKET_SIZE,
  decodePacketRecord,
  encodePacketRecord,
  type PacketPayload,
} from "@/lib/telemetry/packet-codec";

const encoder = new TextEncoder();

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  // subtle.digest 는 ArrayBuffer 기반 뷰만 받으므로 복사본을 넘긴다
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function computeGenesisHash(deviceId: string, startTimeMs: number): Promise<Uint8Array> {
  return sha256(encoder.encode(`PEDAL_EYE_GENESIS_${deviceId}_${startTimeMs}`));
}

/** 데이터 패킷들을 순서대로 체인으로 묶어 .pel 바이트를 만든다(시퀀스는 0부터 다시 매김). */
export async function buildChainedSession(deviceId: string, payloads: readonly PacketPayload[]): Promise<Uint8Array> {
  const first = payloads[0];
  if (!first) throw new RangeError("세션에 패킷이 없습니다.");

  const output = new Uint8Array(payloads.length * PACKET_SIZE + HASH_SIZE);
  let prevHash: Uint8Array = await computeGenesisHash(deviceId, first.timestampMs);
  for (const [index, payload] of payloads.entries()) {
    const packet = encodePacketRecord({ ...payload, sequenceId: index, prevHash });
    output.set(packet, index * PACKET_SIZE);
    prevHash = await sha256(packet);
  }
  output.set(prevHash, payloads.length * PACKET_SIZE);
  return output;
}

export type ChainBreakReason =
  | "MALFORMED_LENGTH"
  | "GENESIS_MISMATCH"
  | "SEQUENCE_GAP"
  | "TIMESTAMP_REVERSED"
  | "PREV_HASH_MISMATCH"
  | "FINAL_HASH_MISMATCH";

export interface HashChainVerificationResult {
  isValid: boolean;
  brokenSequenceId?: number;
  reason?: ChainBreakReason;
  totalRecords: number;
  initialHash: string; // 첫 패킷의 Prev_Record_Hash(제네시스)
  finalHash: string; // 마지막 패킷의 SHA-256
}

/**
 * .pel 전체를 다시 계산해 연속성을 검증한다.
 * brokenSequenceId 는 불일치가 드러난 패킷 번호(패킷 k 를 고치면 k+1 에서, 마지막 패킷이면 그 번호에서 드러남).
 */
export async function verifyBinaryHashChain(
  buffer: Uint8Array,
  options: { expectedInitialHash?: string } = {},
): Promise<HashChainVerificationResult> {
  const body = buffer.length - HASH_SIZE;
  if (body <= 0 || body % PACKET_SIZE !== 0) {
    return { isValid: false, reason: "MALFORMED_LENGTH", totalRecords: 0, initialHash: "", finalHash: "" };
  }
  const total = body / PACKET_SIZE;
  const first = decodePacketRecord(buffer, 0);
  const initialHash = toHex(first.prevHash);
  const fail = (reason: ChainBreakReason, brokenSequenceId: number, finalHash = "") => ({
    isValid: false,
    reason,
    brokenSequenceId,
    totalRecords: total,
    initialHash,
    finalHash,
  });

  if (options.expectedInitialHash && options.expectedInitialHash !== initialHash) {
    return fail("GENESIS_MISMATCH", first.sequenceId);
  }

  let prevHash: Uint8Array = first.prevHash;
  let prevTimestamp = -1;
  let currentHash: Uint8Array = new Uint8Array(0);
  for (let index = 0; index < total; index += 1) {
    const offset = index * PACKET_SIZE;
    const record = decodePacketRecord(buffer, offset);
    if (record.sequenceId !== first.sequenceId + index) return fail("SEQUENCE_GAP", record.sequenceId);
    if (record.timestampMs < prevTimestamp) return fail("TIMESTAMP_REVERSED", record.sequenceId);
    if (!equalBytes(record.prevHash, prevHash)) return fail("PREV_HASH_MISMATCH", record.sequenceId);
    currentHash = await sha256(buffer.subarray(offset, offset + PACKET_SIZE));
    prevHash = currentHash;
    prevTimestamp = record.timestampMs;
  }

  const finalHash = toHex(currentHash);
  if (!equalBytes(buffer.subarray(body), currentHash)) {
    return fail("FINAL_HASH_MISMATCH", first.sequenceId + total - 1, finalHash);
  }
  return { isValid: true, totalRecords: total, initialHash, finalHash };
}
