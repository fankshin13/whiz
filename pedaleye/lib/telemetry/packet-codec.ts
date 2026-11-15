/**
 * 64바이트 고정 패킷 코덱(Little-Endian). 단말 펌웨어·모바일 앱·서버가 같은 배치를 쓴다.
 *
 *  0..3  Sequence_ID u32 | 4..11 Timestamp_UTC u64(ms) | 12..13 Accel_Distance u16(0.01mm)
 *  14 Accel_Percentage u8 | 15..16 Brake_Distance u16 | 17 Brake_Percentage u8
 *  18 Both_Pedal_Flag u8 | 19 Reserved 0 | 20..23 GPS_Latitude i32(1e-7°) | 24..27 GPS_Longitude i32
 *  28..29 GPS_Speed_Kmh u16(0.1km/h) | 30..31 Reserved 0 | 32..63 Prev_Record_Hash(32B)
 */

export const PACKET_SIZE = 64;
export const PAYLOAD_SIZE = 32;
export const HASH_SIZE = 32;

export interface PacketPayload {
  sequenceId: number;
  timestampMs: number;
  accelDistance: number;
  accelPercent: number;
  brakeDistance: number;
  brakePercent: number;
  bothPedal: boolean;
  latitudeE7: number;
  longitudeE7: number;
  speedDeciKmh: number;
}

export interface PacketRecord extends PacketPayload {
  prevHash: Uint8Array; // 32바이트
}

function assertRange(name: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} 값이 범위를 벗어났습니다: ${value}`);
  }
}

export function encodePacketRecord(record: PacketRecord): Uint8Array {
  assertRange("Sequence_ID", record.sequenceId, 0, 0xffffffff);
  assertRange("Timestamp_UTC", record.timestampMs, 0, Number.MAX_SAFE_INTEGER);
  assertRange("Accel_Distance", record.accelDistance, 0, 0xffff);
  assertRange("Accel_Percentage", record.accelPercent, 0, 100);
  assertRange("Brake_Distance", record.brakeDistance, 0, 0xffff);
  assertRange("Brake_Percentage", record.brakePercent, 0, 100);
  assertRange("GPS_Latitude", record.latitudeE7, -900000000, 900000000);
  assertRange("GPS_Longitude", record.longitudeE7, -1800000000, 1800000000);
  assertRange("GPS_Speed_Kmh", record.speedDeciKmh, 0, 0xffff);
  if (record.prevHash.length !== HASH_SIZE) throw new RangeError("Prev_Record_Hash 는 32바이트여야 합니다.");

  const bytes = new Uint8Array(PACKET_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, record.sequenceId, true);
  view.setBigUint64(4, BigInt(record.timestampMs), true);
  view.setUint16(12, record.accelDistance, true);
  view.setUint8(14, record.accelPercent);
  view.setUint16(15, record.brakeDistance, true);
  view.setUint8(17, record.brakePercent);
  view.setUint8(18, record.bothPedal ? 1 : 0);
  view.setUint8(19, 0);
  view.setInt32(20, record.latitudeE7, true);
  view.setInt32(24, record.longitudeE7, true);
  view.setUint16(28, record.speedDeciKmh, true);
  view.setUint16(30, 0, true);
  bytes.set(record.prevHash, PAYLOAD_SIZE);
  return bytes;
}

export function decodePacketRecord(buffer: Uint8Array, offset: number): PacketRecord {
  if (offset < 0 || offset + PACKET_SIZE > buffer.length) {
    throw new RangeError("패킷 범위를 벗어난 오프셋입니다.");
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, PACKET_SIZE);
  return {
    sequenceId: view.getUint32(0, true),
    timestampMs: Number(view.getBigUint64(4, true)),
    accelDistance: view.getUint16(12, true),
    accelPercent: view.getUint8(14),
    brakeDistance: view.getUint16(15, true),
    brakePercent: view.getUint8(17),
    bothPedal: view.getUint8(18) === 1,
    latitudeE7: view.getInt32(20, true),
    longitudeE7: view.getInt32(24, true),
    speedDeciKmh: view.getUint16(28, true),
    prevHash: buffer.slice(offset + PAYLOAD_SIZE, offset + PACKET_SIZE),
  };
}
