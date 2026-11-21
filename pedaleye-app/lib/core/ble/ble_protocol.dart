/// 페달아이 단말 BLE 규격 v1.0 (docs/ble-protocol.md) 의 바이트 형식.
///
/// 앱의 BLE 연결(작업 3)·사고 기록 전송(작업 4)·가짜 단말이 모두 이 파일만 써서 형식을 맞춘다.
/// 모든 정수는 Little-Endian.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import '../forensics/hash_chain.dart' show sha256;
import '../forensics/packet_codec.dart' show packetSize;

// ── 버전·UUID ──────────────────────────────────────────────────────────

const bleProtocolVersion = 0x0101; // v1.1 (상위 바이트 = 주 버전). 1.1: GPS 필드 0 고정(위치정보 미수집)

/// 128비트 UUID: 50454441-4C45-5945-494F-5431SSSSCCCC (SSSS 서비스, CCCC 특성, 서비스 자신은 0000)
String peUuid(int service, [int characteristic = 0]) =>
    '50454441-4c45-5945-494f-5431${service.toRadixString(16).padLeft(4, '0')}${characteristic.toRadixString(16).padLeft(4, '0')}';

abstract final class BleUuids {
  static final deviceInfoService = peUuid(1);
  static final protocolVersion = peUuid(1, 1);
  static final serialNumber = peUuid(1, 2);
  static final hardwareRev = peUuid(1, 3);
  static final firmwareVersion = peUuid(1, 4);
  static final deviceStatus = peUuid(1, 5);

  static final securityService = peUuid(2);
  static final authChallenge = peUuid(2, 1);
  static final authResponse = peUuid(2, 2);
  static final authStatus = peUuid(2, 3);

  static final telemetryService = peUuid(3);
  static final realtimeFrame = peUuid(3, 1);
  static final calibration = peUuid(3, 2);
  static final timeSync = peUuid(3, 3);

  static final forensicService = peUuid(4);
  static final sessionControl = peUuid(4, 1);
  static final sessionDataChunk = peUuid(4, 2);
  static final transferStatus = peUuid(4, 3);
}

/// 64바이트 알림을 받으려면 ATT MTU 가 최소 67(=64+3) 이어야 한다. 연결 직후 247 을 요청한다.
const requestedMtu = 247;
const minimumMtu = packetSize + 3;
const maxChunkPayload = 236; // MTU 247 - ATT 헤더 3 - 청크 헤더 4 - 여유 4
const chunkHeaderSize = 4;

// ── CRC ────────────────────────────────────────────────────────────────

/// CRC-8 (다항식 0x07, 초기값 0x00, 반사 없음). "123456789" → 0xF4
int crc8(List<int> bytes) {
  var crc = 0;
  for (final b in bytes) {
    crc ^= b;
    for (var i = 0; i < 8; i++) {
      crc = (crc & 0x80) != 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

final List<int> _crc32Table = List<int>.generate(256, (n) {
  var c = n;
  for (var k = 0; k < 8; k++) {
    c = (c & 1) != 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c;
});

/// CRC-32 (IEEE 802.3). "123456789" → 0xCBF43926
int crc32(List<int> bytes) {
  var c = 0xffffffff;
  for (final b in bytes) {
    c = _crc32Table[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) & 0xffffffff;
}

// ── 공통 ───────────────────────────────────────────────────────────────

/// UTF-8 문자열을 고정 길이로(남는 자리는 0x00). 넘치면 오류.
Uint8List fixedUtf8(String text, int size) {
  final raw = utf8.encode(text);
  if (raw.length > size) throw ArgumentError('"$text" 는 $size 바이트를 넘습니다.');
  return Uint8List(size)..setRange(0, raw.length, raw);
}

/// 단말이 만드는 해시 체인의 시작값. 단말은 서버의 단말 ID 를 모르므로 일련번호를 쓴다.
Uint8List deviceGenesisHash(String serial, int startTimeMs) =>
    sha256(utf8.encode('PEDAL_EYE_GENESIS_${serial}_$startTimeMs'));

class BleFormatException implements Exception {
  const BleFormatException(this.message);
  final String message;
  @override
  String toString() => 'BleFormatException: $message';
}

// ── 단말 인증(Ed25519) ─────────────────────────────────────────────────

const attestationNonceSize = 32;
const signatureSize = 64;
const publicKeySize = 32;
final Uint8List attestationDomainTag = fixedUtf8('PEDAL_EYE_DEVICE_ATTESTATION_V1', 32);
final Uint8List sessionSealDomainTag = fixedUtf8('PEDAL_EYE_SESSION_SEAL_V1', 32);

/// 서명 대상(80바이트) = 도메인 태그 32 ‖ 일련번호 16 ‖ 앱 난수 32
Uint8List attestationMessage(String serial, Uint8List nonce) {
  if (nonce.length != attestationNonceSize) throw const BleFormatException('챌린지는 32바이트여야 합니다.');
  return Uint8List.fromList([...attestationDomainTag, ...fixedUtf8(serial, 16), ...nonce]);
}

final _ed25519 = Ed25519();

Future<bool> verifyEd25519(Uint8List message, Uint8List signature, Uint8List publicKey) async {
  if (signature.length != signatureSize || publicKey.length != publicKeySize) return false;
  return _ed25519.verify(
    message,
    signature: Signature(signature, publicKey: SimplePublicKey(publicKey, type: KeyPairType.ed25519)),
  );
}

/// 단말 인증 응답 검증: 서버에 등록된 공개키로 (도메인 ‖ 일련번호 ‖ 난수) 서명을 확인한다.
Future<bool> verifyAttestation({
  required String serial,
  required Uint8List nonce,
  required Uint8List signature,
  required Uint8List publicKey,
}) =>
    verifyEd25519(attestationMessage(serial, nonce), signature, publicKey);

enum AuthStatus { unauthenticated, responded, error }

AuthStatus decodeAuthStatus(Uint8List b) {
  if (b.length != 1 || b[0] > 2) throw const BleFormatException('Auth Status 형식 오류');
  return AuthStatus.values[b[0]];
}

// ── 보정·시각·상태 ─────────────────────────────────────────────────────

/// 보정값(0.01mm): 가속 최소·최대, 제동 최소·최대 (u16 ×4 = 8바이트)
class CalibrationValues {
  const CalibrationValues({required this.accelMin, required this.accelMax, required this.brakeMin, required this.brakeMax});
  final int accelMin;
  final int accelMax;
  final int brakeMin;
  final int brakeMax;

  Uint8List encode() {
    for (final v in [accelMin, accelMax, brakeMin, brakeMax]) {
      if (v < 0 || v > 0xffff) throw BleFormatException('보정값 범위 오류: $v');
    }
    final b = ByteData(8)
      ..setUint16(0, accelMin, Endian.little)
      ..setUint16(2, accelMax, Endian.little)
      ..setUint16(4, brakeMin, Endian.little)
      ..setUint16(6, brakeMax, Endian.little);
    return b.buffer.asUint8List();
  }

  static CalibrationValues decode(Uint8List bytes) {
    if (bytes.length != 8) throw const BleFormatException('보정값은 8바이트여야 합니다.');
    final v = ByteData.sublistView(bytes);
    return CalibrationValues(
      accelMin: v.getUint16(0, Endian.little),
      accelMax: v.getUint16(2, Endian.little),
      brakeMin: v.getUint16(4, Endian.little),
      brakeMax: v.getUint16(6, Endian.little),
    );
  }
}

Uint8List encodeTimeSync(int epochMs) => (ByteData(8)..setUint64(0, epochMs, Endian.little)).buffer.asUint8List();

class DeviceStatus {
  const DeviceStatus({required this.batteryPercent, required this.sensorOk, required this.rtcSynced, required this.storageFull, required this.storedSessions});
  final int batteryPercent;
  final bool sensorOk;
  final bool rtcSynced;
  final bool storageFull;
  final int storedSessions;

  static DeviceStatus decode(Uint8List b) {
    if (b.length != 4) throw const BleFormatException('Device Status 는 4바이트여야 합니다.');
    final flags = b[1];
    return DeviceStatus(
      batteryPercent: b[0],
      sensorOk: flags & 0x01 != 0,
      rtcSynced: flags & 0x02 != 0,
      storageFull: flags & 0x04 != 0,
      storedSessions: ByteData.sublistView(b).getUint16(2, Endian.little),
    );
  }
}

// ── 사고 기록 전송 ─────────────────────────────────────────────────────

enum SessionCommand {
  start(0x01),
  pause(0x02),
  cancel(0x03),
  list(0x04),
  confirmArchived(0x05);

  const SessionCommand(this.code);
  final int code;
}

/// Session Control 쓰기(12바이트): 명령 u8 ‖ 세션 ID u32 ‖ 바이트 오프셋 u32 ‖ 예약 3
Uint8List encodeSessionControl(SessionCommand command, {int sessionId = 0, int offset = 0}) {
  final b = ByteData(12)
    ..setUint8(0, command.code)
    ..setUint32(1, sessionId, Endian.little)
    ..setUint32(5, offset, Endian.little);
  return b.buffer.asUint8List();
}

class DataChunk {
  const DataChunk({required this.seq, required this.payload});
  final int seq;
  final Uint8List payload;

  Uint8List encode() {
    if (payload.length > maxChunkPayload) throw const BleFormatException('청크 페이로드가 236바이트를 넘습니다.');
    final header = ByteData(chunkHeaderSize)
      ..setUint16(0, seq, Endian.little)
      ..setUint8(2, payload.length)
      ..setUint8(3, crc8(payload));
    return Uint8List.fromList([...header.buffer.asUint8List(), ...payload]);
  }

  /// 길이·CRC8 이 맞지 않으면 [BleFormatException] (앱은 NACK 로 재요청)
  static DataChunk decode(Uint8List bytes) {
    if (bytes.length < chunkHeaderSize) throw const BleFormatException('청크가 너무 짧습니다.');
    final v = ByteData.sublistView(bytes);
    final size = v.getUint8(2);
    if (size > maxChunkPayload || bytes.length != chunkHeaderSize + size) throw const BleFormatException('청크 길이 불일치');
    final payload = Uint8List.fromList(bytes.sublist(chunkHeaderSize));
    if (crc8(payload) != v.getUint8(3)) throw const BleFormatException('청크 CRC8 불일치');
    return DataChunk(seq: v.getUint16(0, Endian.little), payload: payload);
  }
}

/// 바이트 오프셋부터 청크로 나눈다(가짜 단말·시험용). seq 는 START 마다 0부터.
List<DataChunk> splitIntoChunks(Uint8List data, int offset) => [
  for (var pos = offset, seq = 0; pos < data.length; pos += maxChunkPayload, seq++)
    DataChunk(seq: seq, payload: Uint8List.fromList(data.sublist(pos, pos + maxChunkPayload > data.length ? data.length : pos + maxChunkPayload))),
];

enum TransferState { idle, listing, sending, paused, complete, error }

/// Transfer Status 읽기(18바이트)
class TransferStatus {
  const TransferStatus({required this.state, required this.errorCode, required this.sessionId, required this.totalBytes, required this.sentBytes, required this.crc32});
  final TransferState state;
  final int errorCode;
  final int sessionId;
  final int totalBytes;
  final int sentBytes;
  final int crc32;

  static TransferStatus decode(Uint8List b) {
    if (b.length != 18) throw const BleFormatException('Transfer Status 는 18바이트여야 합니다.');
    final v = ByteData.sublistView(b);
    if (b[0] >= TransferState.values.length) throw const BleFormatException('알 수 없는 전송 상태');
    return TransferStatus(
      state: TransferState.values[b[0]],
      errorCode: b[1],
      sessionId: v.getUint32(2, Endian.little),
      totalBytes: v.getUint32(6, Endian.little),
      sentBytes: v.getUint32(10, Endian.little),
      crc32: v.getUint32(14, Endian.little),
    );
  }
}

/// Transfer Status 쓰기(3바이트): ACK(0x10, 여기까지 받음) / NACK(0x11, 이 청크부터 다시)
Uint8List encodeAck(int chunkSeq) => (ByteData(3)..setUint8(0, 0x10)..setUint16(1, chunkSeq, Endian.little)).buffer.asUint8List();
Uint8List encodeNack(int chunkSeq) => (ByteData(3)..setUint8(0, 0x11)..setUint16(1, chunkSeq, Endian.little)).buffer.asUint8List();

/// 오류 코드(ATT 응용 오류·Transfer Status errorCode 공통)
abstract final class BleErrorCodes {
  static const notAuthenticated = 0x80;
  static const invalidSession = 0x81;
  static const invalidOffset = 0x82;
  static const busy = 0x83;
  static const storageError = 0x84;
  static const invalidCalibration = 0x85;
  static const unsupportedVersion = 0x86;
}

const sessionTriggers = ['shock', 'sudden_accel', 'manual', 'periodic']; // DB trigger_type 순서

/// 사고 기록 목록 항목(120바이트). LIST 명령 뒤 청크 하나에 하나씩 온다.
class SessionIndexEntry {
  const SessionIndexEntry({
    required this.sessionId,
    required this.trigger,
    required this.archivedConfirmed,
    required this.startMs,
    required this.recordCount,
    required this.byteLength,
    required this.finalHash,
    required this.sealSignature,
  });
  static const size = 120;

  final int sessionId;
  final String trigger;
  final bool archivedConfirmed;
  final int startMs;
  final int recordCount;
  final int byteLength;
  final Uint8List finalHash;
  final Uint8List sealSignature;

  static SessionIndexEntry decode(Uint8List b) {
    if (b.length != size) throw const BleFormatException('목록 항목은 120바이트여야 합니다.');
    final v = ByteData.sublistView(b);
    final trigger = b[4];
    if (trigger >= sessionTriggers.length) throw const BleFormatException('알 수 없는 트리거');
    final entry = SessionIndexEntry(
      sessionId: v.getUint32(0, Endian.little),
      trigger: sessionTriggers[trigger],
      archivedConfirmed: b[5] & 0x01 != 0,
      startMs: v.getUint64(8, Endian.little),
      recordCount: v.getUint32(16, Endian.little),
      byteLength: v.getUint32(20, Endian.little),
      finalHash: Uint8List.fromList(b.sublist(24, 56)),
      sealSignature: Uint8List.fromList(b.sublist(56, 120)),
    );
    if (entry.byteLength != entry.recordCount * packetSize + 32) throw const BleFormatException('세션 길이와 레코드 수가 맞지 않습니다.');
    return entry;
  }

  /// 봉인 서명 대상(96바이트) = 도메인 32 ‖ 일련번호 16 ‖ 세션 ID u32 ‖ 시작 u64 ‖ 레코드 수 u32 ‖ 최종 해시 32
  Uint8List sealMessage(String serial) {
    final fields = ByteData(16)
      ..setUint32(0, sessionId, Endian.little)
      ..setUint64(4, startMs, Endian.little)
      ..setUint32(12, recordCount, Endian.little);
    return Uint8List.fromList([...sessionSealDomainTag, ...fixedUtf8(serial, 16), ...fields.buffer.asUint8List(), ...finalHash]);
  }

  Future<bool> verifySeal(String serial, Uint8List publicKey) => verifyEd25519(sealMessage(serial), sealSignature, publicKey);
}
