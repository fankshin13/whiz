/// 64바이트 고정 패킷 코덱(Little-Endian). 웹 lib/telemetry/packet-codec.ts 와 같은 배치다.
///
///  0..3  Sequence_ID u32 | 4..11 Timestamp_UTC u64(ms) | 12..13 Accel_Distance u16(0.01mm)
///  14 Accel_Percentage u8 | 15..16 Brake_Distance u16 | 17 Brake_Percentage u8
///  18 Both_Pedal_Flag u8 | 19 Reserved 0 | 20..23 GPS_Latitude i32(1e-7°) | 24..27 GPS_Longitude i32
///  28..29 GPS_Speed_Kmh u16(0.1km/h) | 30..31 Reserved 0 | 32..63 Prev_Record_Hash(32B)
library;

import 'dart:typed_data';

const packetSize = 64;
const payloadSize = 32;
const hashSize = 32;

class PacketPayload {
  const PacketPayload({
    required this.sequenceId,
    required this.timestampMs,
    required this.accelDistance,
    required this.accelPercent,
    required this.brakeDistance,
    required this.brakePercent,
    required this.bothPedal,
    required this.latitudeE7,
    required this.longitudeE7,
    required this.speedDeciKmh,
  });

  final int sequenceId;
  final int timestampMs;
  final int accelDistance;
  final int accelPercent;
  final int brakeDistance;
  final int brakePercent;
  final bool bothPedal;
  final int latitudeE7;
  final int longitudeE7;
  final int speedDeciKmh;
}

class PacketRecord extends PacketPayload {
  const PacketRecord({
    required super.sequenceId,
    required super.timestampMs,
    required super.accelDistance,
    required super.accelPercent,
    required super.brakeDistance,
    required super.brakePercent,
    required super.bothPedal,
    required super.latitudeE7,
    required super.longitudeE7,
    required super.speedDeciKmh,
    required this.prevHash,
  });

  static PacketRecord from(PacketPayload p, {required int sequenceId, required Uint8List prevHash}) => PacketRecord(
    sequenceId: sequenceId,
    timestampMs: p.timestampMs,
    accelDistance: p.accelDistance,
    accelPercent: p.accelPercent,
    brakeDistance: p.brakeDistance,
    brakePercent: p.brakePercent,
    bothPedal: p.bothPedal,
    latitudeE7: p.latitudeE7,
    longitudeE7: p.longitudeE7,
    speedDeciKmh: p.speedDeciKmh,
    prevHash: prevHash,
  );

  /// 32바이트
  final Uint8List prevHash;
}

void _assertRange(String name, int value, int min, int max) {
  if (value < min || value > max) throw RangeError('$name 값이 범위를 벗어났습니다: $value');
}

Uint8List encodePacketRecord(PacketRecord r) {
  _assertRange('Sequence_ID', r.sequenceId, 0, 0xFFFFFFFF);
  _assertRange('Timestamp_UTC', r.timestampMs, 0, 9007199254740991);
  _assertRange('Accel_Distance', r.accelDistance, 0, 0xFFFF);
  _assertRange('Accel_Percentage', r.accelPercent, 0, 100);
  _assertRange('Brake_Distance', r.brakeDistance, 0, 0xFFFF);
  _assertRange('Brake_Percentage', r.brakePercent, 0, 100);
  _assertRange('GPS_Latitude', r.latitudeE7, -900000000, 900000000);
  _assertRange('GPS_Longitude', r.longitudeE7, -1800000000, 1800000000);
  _assertRange('GPS_Speed_Kmh', r.speedDeciKmh, 0, 0xFFFF);
  if (r.prevHash.length != hashSize) throw RangeError('Prev_Record_Hash 는 32바이트여야 합니다.');

  final bytes = Uint8List(packetSize);
  final view = ByteData.sublistView(bytes)
    ..setUint32(0, r.sequenceId, Endian.little)
    ..setUint64(4, r.timestampMs, Endian.little)
    ..setUint16(12, r.accelDistance, Endian.little)
    ..setUint8(14, r.accelPercent)
    ..setUint16(15, r.brakeDistance, Endian.little)
    ..setUint8(17, r.brakePercent)
    ..setUint8(18, r.bothPedal ? 1 : 0)
    ..setUint8(19, 0)
    ..setInt32(20, r.latitudeE7, Endian.little)
    ..setInt32(24, r.longitudeE7, Endian.little)
    ..setUint16(28, r.speedDeciKmh, Endian.little)
    ..setUint16(30, 0, Endian.little);
  assert(view.lengthInBytes == packetSize);
  bytes.setRange(payloadSize, packetSize, r.prevHash);
  return bytes;
}

PacketRecord decodePacketRecord(Uint8List buffer, int offset) {
  if (offset < 0 || offset + packetSize > buffer.length) throw RangeError('패킷 범위를 벗어난 오프셋입니다.');
  final view = ByteData.sublistView(buffer, offset, offset + packetSize);
  return PacketRecord(
    sequenceId: view.getUint32(0, Endian.little),
    timestampMs: view.getUint64(4, Endian.little),
    accelDistance: view.getUint16(12, Endian.little),
    accelPercent: view.getUint8(14),
    brakeDistance: view.getUint16(15, Endian.little),
    brakePercent: view.getUint8(17),
    bothPedal: view.getUint8(18) == 1,
    latitudeE7: view.getInt32(20, Endian.little),
    longitudeE7: view.getInt32(24, Endian.little),
    speedDeciKmh: view.getUint16(28, Endian.little),
    prevHash: Uint8List.fromList(buffer.sublist(offset + payloadSize, offset + packetSize)),
  );
}

/// .pel 의 패킷 개수(형식이 틀리면 0)
int packetCountOf(Uint8List pel) {
  final body = pel.length - hashSize;
  return body > 0 && body % packetSize == 0 ? body ~/ packetSize : 0;
}

List<PacketRecord> decodeAllPackets(Uint8List pel) => [
  for (var i = 0; i < packetCountOf(pel); i++) decodePacketRecord(pel, i * packetSize),
];
