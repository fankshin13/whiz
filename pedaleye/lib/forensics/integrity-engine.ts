/**
 * 포렌식 파서·검증기. 해시 체인 규칙은 lib/telemetry/hash-chain-engine.ts 를 그대로 쓰고,
 * 여기서는 사람이 읽을 단위(mm, km/h, 위경도, 서울 시각)로 풀고 실패 상세를 정리한다.
 * 브라우저(로컬 파일 즉석 검증)와 서버(저장된 세션 재검증)에서 같이 쓴다.
 */
import { sha256, toHex, verifyBinaryHashChain, type ChainBreakReason } from "@/lib/telemetry/hash-chain-engine";
import { HASH_SIZE, PACKET_SIZE, decodePacketRecord } from "@/lib/telemetry/packet-codec";
import type { DecodedPacket, VerificationResult } from "@/types/forensics";

export const MALFORMED_FILE_MESSAGE = "로그 파일 크기가 64바이트 레코드 배수가 아닙니다.";

export const BREAK_REASON_TEXT: Record<ChainBreakReason, string> = {
  MALFORMED_LENGTH: MALFORMED_FILE_MESSAGE,
  GENESIS_MISMATCH: "첫 패킷의 시작 해시가 이 단말의 제네시스와 다릅니다",
  SEQUENCE_GAP: "패킷 번호가 이어지지 않습니다(누락·삽입)",
  TIMESTAMP_REVERSED: "패킷 시각이 거꾸로 갑니다",
  PREV_HASH_MISMATCH: "직전 패킷 해시가 맞지 않습니다",
  FINAL_HASH_MISMATCH: "마지막 패킷이 파일 끝 해시와 맞지 않습니다",
};

const SEOUL_OFFSET_MS = 9 * 3_600_000;

/** epoch ms → "2026-11-15T09:00:00.050+09:00" (서울은 서머타임이 없어 고정 오프셋) */
export function toSeoulIso(ms: number): string {
  return new Date(ms + SEOUL_OFFSET_MS).toISOString().replace("Z", "+09:00");
}

export function isWellFormedLog(buffer: Uint8Array): boolean {
  const body = buffer.length - HASH_SIZE;
  return body > 0 && body % PACKET_SIZE === 0;
}

export async function parsePacketRecord(buffer: Uint8Array, offset: number): Promise<DecodedPacket> {
  const record = decodePacketRecord(buffer, offset);
  return {
    sequenceId: record.sequenceId,
    timestampUtc: record.timestampMs,
    timestampIso: toSeoulIso(record.timestampMs),
    accelDistanceMm: record.accelDistance / 100,
    accelPercent: record.accelPercent,
    brakeDistanceMm: record.brakeDistance / 100,
    brakePercent: record.brakePercent,
    bothPedalFlag: record.bothPedal,
    latitude: record.latitudeE7 / 1e7,
    longitude: record.longitudeE7 / 1e7,
    speedKmh: record.speedDeciKmh / 10,
    prevRecordHash: toHex(record.prevHash),
    calculatedHash: toHex(await sha256(buffer.subarray(offset, offset + PACKET_SIZE))),
  };
}

export async function parseAllPackets(buffer: Uint8Array): Promise<DecodedPacket[]> {
  if (!isWellFormedLog(buffer)) return [];
  const total = (buffer.length - HASH_SIZE) / PACKET_SIZE;
  return Promise.all(Array.from({ length: total }, (_, index) => parsePacketRecord(buffer, index * PACKET_SIZE)));
}

/** 전수 검증. genesisHash 를 주면 첫 패킷이 그 단말의 제네시스로 시작하는지도 확인한다. */
export async function verifyLogFileIntegrity(rawBuffer: Uint8Array, genesisHash?: string): Promise<VerificationResult> {
  const started = performance.now();
  const result = await verifyBinaryHashChain(rawBuffer, { expectedInitialHash: genesisHash });
  const verificationDurationMs = Math.round((performance.now() - started) * 10) / 10;

  return {
    isValid: result.isValid,
    totalRecords: result.totalRecords,
    initialHash: result.initialHash,
    finalHash: result.finalHash,
    verificationDurationMs,
    failureDetail:
      result.isValid || !result.reason
        ? undefined
        : {
            failedSequenceId: result.brokenSequenceId ?? 0,
            timestampUtc: result.brokenTimestampMs ?? 0,
            expectedHash: result.expectedHash ?? "",
            actualHash: result.actualHash ?? "",
            reason: BREAK_REASON_TEXT[result.reason],
          },
  };
}
