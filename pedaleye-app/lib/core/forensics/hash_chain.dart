/// SHA-256 해시 체인. 웹 lib/telemetry/hash-chain-engine.ts 와 같은 계산이다.
///
///  H(-1) = SHA-256("PEDAL_EYE_GENESIS_" + deviceId + "_" + 첫 패킷 시각(ms))
///  패킷 i 의 [32..63] = H(i-1),  H(i) = SHA-256(패킷 i 전체 64바이트 = 데이터 32B ‖ H(i-1))
///
/// .pel 세션 파일 = 패킷 N개(64×N 바이트) + 끝에 Final_Chain_Hash(H(N-1), 32바이트).
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;

import 'packet_codec.dart';

Uint8List sha256(List<int> bytes) => Uint8List.fromList(crypto.sha256.convert(bytes).bytes);

String toHex(List<int> bytes) => bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

bool _equalBytes(List<int> a, List<int> b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

Uint8List computeGenesisHash(String deviceId, int startTimeMs) =>
    sha256(utf8.encode('PEDAL_EYE_GENESIS_${deviceId}_$startTimeMs'));

/// 데이터 패킷들을 순서대로 체인으로 묶어 .pel 바이트를 만든다(시퀀스는 0부터 다시 매김).
Uint8List buildChainedSession(String deviceId, List<PacketPayload> payloads) {
  if (payloads.isEmpty) throw RangeError('세션에 패킷이 없습니다.');
  final output = Uint8List(payloads.length * packetSize + hashSize);
  var prevHash = computeGenesisHash(deviceId, payloads.first.timestampMs);
  for (var i = 0; i < payloads.length; i++) {
    final packet = encodePacketRecord(PacketRecord.from(payloads[i], sequenceId: i, prevHash: prevHash));
    output.setRange(i * packetSize, (i + 1) * packetSize, packet);
    prevHash = sha256(packet);
  }
  output.setRange(payloads.length * packetSize, output.length, prevHash);
  return output;
}

enum ChainBreakReason {
  malformedLength,
  genesisMismatch,
  sequenceGap,
  timestampReversed,
  prevHashMismatch,
  finalHashMismatch,
}

class HashChainVerificationResult {
  const HashChainVerificationResult({
    required this.isValid,
    required this.totalRecords,
    required this.initialHash,
    required this.finalHash,
    this.reason,
    this.brokenSequenceId,
    this.brokenTimestampMs,
    this.expectedHash,
    this.actualHash,
  });

  final bool isValid;
  final int totalRecords;

  /// 첫 패킷의 Prev_Record_Hash(제네시스)
  final String initialHash;

  /// 마지막 패킷의 SHA-256
  final String finalHash;
  final ChainBreakReason? reason;
  final int? brokenSequenceId;
  final int? brokenTimestampMs;
  final String? expectedHash;
  final String? actualHash;
}

/// .pel 전체를 다시 계산해 연속성을 검증한다.
/// brokenSequenceId 는 불일치가 드러난 패킷 번호(패킷 k 를 고치면 k+1 에서, 마지막 패킷이면 그 번호에서 드러남).
HashChainVerificationResult verifyBinaryHashChain(Uint8List buffer, {String? expectedInitialHash}) {
  final body = buffer.length - hashSize;
  if (body <= 0 || body % packetSize != 0) {
    return const HashChainVerificationResult(
      isValid: false,
      reason: ChainBreakReason.malformedLength,
      totalRecords: 0,
      initialHash: '',
      finalHash: '',
    );
  }
  final total = body ~/ packetSize;
  final first = decodePacketRecord(buffer, 0);
  final initialHash = toHex(first.prevHash);

  HashChainVerificationResult fail(
    ChainBreakReason reason,
    PacketRecord at, {
    String? expected,
    String? actual,
    String finalHash = '',
  }) => HashChainVerificationResult(
    isValid: false,
    reason: reason,
    brokenSequenceId: at.sequenceId,
    brokenTimestampMs: at.timestampMs,
    expectedHash: expected,
    actualHash: actual,
    totalRecords: total,
    initialHash: initialHash,
    finalHash: finalHash,
  );

  if (expectedInitialHash != null && expectedInitialHash != initialHash) {
    return fail(ChainBreakReason.genesisMismatch, first, expected: expectedInitialHash, actual: initialHash);
  }

  var prevHash = first.prevHash;
  var prevTimestamp = -1;
  var currentHash = Uint8List(0);
  for (var index = 0; index < total; index++) {
    final offset = index * packetSize;
    final record = decodePacketRecord(buffer, offset);
    if (record.sequenceId != first.sequenceId + index) return fail(ChainBreakReason.sequenceGap, record);
    if (record.timestampMs < prevTimestamp) return fail(ChainBreakReason.timestampReversed, record);
    if (!_equalBytes(record.prevHash, prevHash)) {
      return fail(ChainBreakReason.prevHashMismatch, record, expected: toHex(prevHash), actual: toHex(record.prevHash));
    }
    currentHash = sha256(Uint8List.sublistView(buffer, offset, offset + packetSize));
    prevHash = currentHash;
    prevTimestamp = record.timestampMs;
  }

  final finalHash = toHex(currentHash);
  final stored = Uint8List.sublistView(buffer, body);
  if (!_equalBytes(stored, currentHash)) {
    final last = decodePacketRecord(buffer, (total - 1) * packetSize);
    return fail(
      ChainBreakReason.finalHashMismatch,
      last,
      expected: finalHash,
      actual: toHex(stored),
      finalHash: finalHash,
    );
  }
  return HashChainVerificationResult(
    isValid: true,
    totalRecords: total,
    initialHash: initialHash,
    finalHash: finalHash,
  );
}
