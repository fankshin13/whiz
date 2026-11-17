import { createPublicKey, verify } from "node:crypto";

/**
 * 단말 세션 봉인 서명(docs/ble-protocol.md 5.6).
 * 서명 대상 96바이트 = 도메인 32 ‖ 일련번호 16 ‖ 세션 번호 u32 ‖ 시작 시각 u64 ‖ 레코드 수 u32 ‖ 최종 해시 32 (모두 Little-Endian)
 */
const SEAL_DOMAIN = fixedUtf8("PEDAL_EYE_SESSION_SEAL_V1", 32);
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function fixedUtf8(text: string, size: number): Buffer {
  const raw = Buffer.from(text, "utf8");
  if (raw.length > size) throw new RangeError(`${text} 는 ${size}바이트를 넘습니다.`);
  const out = Buffer.alloc(size);
  raw.copy(out);
  return out;
}

export function sealMessage(input: { serial: string; sessionIndex: number; startMs: number; recordCount: number; finalHash: Uint8Array }): Buffer {
  const fields = Buffer.alloc(16);
  fields.writeUInt32LE(input.sessionIndex, 0);
  fields.writeBigUInt64LE(BigInt(input.startMs), 4);
  fields.writeUInt32LE(input.recordCount, 12);
  return Buffer.concat([SEAL_DOMAIN, fixedUtf8(input.serial, 16), fields, Buffer.from(input.finalHash)]);
}

/** 등록된 공개키(Base64 32바이트)로 봉인 서명(Base64 64바이트)을 확인한다. 형식이 틀리면 false. */
export function verifySeal(publicKeyBase64: string | null, signatureBase64: string, message: Buffer): boolean {
  if (!publicKeyBase64) return false;
  const key = Buffer.from(publicKeyBase64, "base64");
  const signature = Buffer.from(signatureBase64, "base64");
  if (key.length !== 32 || signature.length !== 64) return false;
  try {
    return verify(null, message, createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, key]), format: "der", type: "spki" }), signature);
  } catch {
    return false;
  }
}

/** 해시 체인 시작값의 기준: 단말이 봉인한 기록은 일련번호, 앱이 만든 기록은 단말 ID */
export function genesisSubject(session: { deviceId: string; serial: string; sealed: boolean }): string {
  return session.sealed ? session.serial : session.deviceId;
}
