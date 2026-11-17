// docs/ble-protocol.md 의 바이트 형식을 시험 벡터(test/fixtures/ble_test_vectors.json)로 확인한다.
// 벡터는 tool/generate_ble_vectors.mjs(Node 내장 암호 모듈)로 만든 것이라, 앱과 다른 구현이 같은 결과를 내는지 교차 검증된다.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/core/ble/ble_protocol.dart';
import 'package:pedaleye_app/core/forensics/hash_chain.dart';
import 'package:pedaleye_app/core/forensics/packet_codec.dart';

Uint8List h(String hex) => Uint8List.fromList([for (var i = 0; i < hex.length; i += 2) int.parse(hex.substring(i, i + 2), radix: 16)]);

void main() {
  final v = jsonDecode(File('test/fixtures/ble_test_vectors.json').readAsStringSync()) as Map<String, dynamic>;
  final serial = v['serial'] as String;
  final attest = v['attestation'] as Map<String, dynamic>;
  final publicKey = h(attest['publicKey'] as String);

  test('UUID 는 서비스·특성마다 고유하고 베이스 형식을 따른다', () {
    final all = [
      BleUuids.deviceInfoService, BleUuids.protocolVersion, BleUuids.serialNumber, BleUuids.hardwareRev, BleUuids.firmwareVersion,
      BleUuids.deviceStatus, BleUuids.securityService, BleUuids.authChallenge, BleUuids.authResponse, BleUuids.authStatus,
      BleUuids.telemetryService, BleUuids.realtimeFrame, BleUuids.calibration, BleUuids.timeSync,
      BleUuids.forensicService, BleUuids.sessionControl, BleUuids.sessionDataChunk, BleUuids.transferStatus,
    ];
    expect(all.toSet(), hasLength(all.length));
    expect(BleUuids.realtimeFrame, '50454441-4c45-5945-494f-543100030001');
    for (final uuid in all) {
      expect(uuid, matches(RegExp(r'^50454441-4c45-5945-494f-5431[0-9a-f]{8}$')));
    }
  });

  test('CRC8·CRC32 표준 검사값', () {
    final crc = v['crc'] as Map<String, dynamic>;
    final input = h(crc['input'] as String);
    expect(crc8(input), 0xF4);
    expect(crc32(input), 0xCBF43926);
    expect(crc['crc8'], 0xF4);
    expect(crc['crc32'], 0xCBF43926);
  });

  group('단말 인증', () {
    final nonce = h(attest['nonce'] as String);
    final signature = h(attest['signature'] as String);

    test('서명 대상 80바이트가 규격과 같다', () {
      final message = attestationMessage(serial, nonce);
      expect(message, hasLength(80));
      expect(toHex(message), attest['message']);
      expect(toHex(attestationDomainTag), attest['domainTag']);
    });

    test('등록된 공개키로 서명이 검증되고, 서명·일련번호·키·난수가 다르면 거부된다', () async {
      expect(await verifyAttestation(serial: serial, nonce: nonce, signature: signature, publicKey: publicKey), isTrue);
      expect(await verifyAttestation(serial: serial, nonce: nonce, signature: h(attest['tamperedSignature'] as String), publicKey: publicKey), isFalse);
      expect(await verifyAttestation(serial: 'PE-2026-000002', nonce: nonce, signature: signature, publicKey: publicKey), isFalse);
      final otherNonce = Uint8List.fromList(nonce)..[0] ^= 1;
      expect(await verifyAttestation(serial: serial, nonce: otherNonce, signature: signature, publicKey: publicKey), isFalse);
      final otherKey = Uint8List.fromList(publicKey)..[5] ^= 1;
      expect(await verifyAttestation(serial: serial, nonce: nonce, signature: signature, publicKey: otherKey), isFalse);
      expect(await verifyAttestation(serial: serial, nonce: nonce, signature: signature.sublist(0, 63), publicKey: publicKey), isFalse);
      expect(() => attestationMessage(serial, Uint8List(31)), throwsA(isA<BleFormatException>()));
      expect(() => fixedUtf8('PE-2026-0000000001', 16), throwsArgumentError);
    });
  });

  test('실시간 프레임은 기존 64바이트 패킷이며 일련번호 기준 해시 체인으로 이어진다', () {
    final rt = v['realtime'] as Map<String, dynamic>;
    final packets = (rt['packets'] as List).cast<Map<String, dynamic>>();
    final first = packets.first['fields'] as Map<String, dynamic>;
    var prev = deviceGenesisHash(serial, first['timestampMs'] as int);
    expect(toHex(prev), rt['genesisHash']);
    for (final p in packets) {
      final bytes = h(p['hex'] as String);
      expect(bytes, hasLength(64));
      final record = decodePacketRecord(bytes, 0);
      final f = p['fields'] as Map<String, dynamic>;
      expect(record.sequenceId, f['sequenceId']);
      expect(record.timestampMs, f['timestampMs']);
      expect(record.accelDistance, f['accelDistance']);
      expect(record.accelPercent, f['accelPercent']);
      expect(record.brakeDistance, f['brakeDistance']);
      expect(record.brakePercent, f['brakePercent']);
      expect(record.bothPedal, f['bothPedal']);
      expect(record.latitudeE7, f['latitudeE7']);
      expect(record.longitudeE7, f['longitudeE7']);
      expect(record.speedDeciKmh, f['speedDeciKmh']);
      expect(toHex(record.prevHash), toHex(prev));
      // 앱 인코더가 같은 바이트를 만든다
      expect(toHex(encodePacketRecord(record)), p['hex']);
      prev = sha256(bytes);
      expect(toHex(prev), p['hash']);
    }
    expect(toHex(prev), rt['finalHash']);
  });

  test('보정·시각·상태 형식', () {
    final c = v['calibration'] as Map<String, dynamic>;
    final calib = CalibrationValues.decode(h(c['hex'] as String));
    expect([calib.accelMin, calib.accelMax, calib.brakeMin, calib.brakeMax], [c['accelMin'], c['accelMax'], c['brakeMin'], c['brakeMax']]);
    expect(toHex(calib.encode()), c['hex']);
    expect(() => CalibrationValues.decode(Uint8List(7)), throwsA(isA<BleFormatException>()));

    final t = v['timeSync'] as Map<String, dynamic>;
    expect(toHex(encodeTimeSync(t['epochMs'] as int)), t['hex']);

    final s = v['deviceStatus'] as Map<String, dynamic>;
    final status = DeviceStatus.decode(h(s['hex'] as String));
    expect([status.batteryPercent, status.sensorOk, status.rtcSynced, status.storageFull, status.storedSessions], [87, true, true, false, 2]);
  });

  group('사고 기록 전송', () {
    final s = v['session'] as Map<String, dynamic>;
    final pel = h(s['pel'] as String);
    final control = v['control'] as Map<String, dynamic>;

    test('제어 명령·ACK/NACK 바이트', () {
      final id = s['sessionId'] as int;
      expect(toHex(encodeSessionControl(SessionCommand.start, sessionId: id)), control['start']);
      expect(toHex(encodeSessionControl(SessionCommand.start, sessionId: id, offset: s['resumeOffset'] as int)), control['resume']);
      expect(toHex(encodeSessionControl(SessionCommand.pause, sessionId: id)), control['pause']);
      expect(toHex(encodeSessionControl(SessionCommand.cancel, sessionId: id)), control['cancel']);
      expect(toHex(encodeSessionControl(SessionCommand.list)), control['list']);
      expect(toHex(encodeSessionControl(SessionCommand.confirmArchived, sessionId: id)), control['confirmArchived']);
      expect(toHex(encodeAck(1)), control['ack']);
      expect(toHex(encodeNack(1)), control['nack']);
    });

    test('.pel 은 기존 형식(64×N + 최종 해시)이고 일련번호 기준 체인으로 검증된다', () {
      expect(packetCountOf(pel), s['recordCount']);
      final firstMs = decodePacketRecord(pel, 0).timestampMs;
      expect(toHex(deviceGenesisHash(serial, firstMs)), s['genesisHash']);
      final result = verifyBinaryHashChain(pel, expectedInitialHash: s['genesisHash'] as String);
      expect(result.isValid, isTrue);
      expect(result.finalHash, s['finalHash']);
      expect(crc32(pel), s['crc32']);
    });

    test('청크를 처음부터·이어받기 오프셋부터 받아 같은 파일을 만들고, CRC8 오류를 잡는다', () {
      Uint8List assemble(List<dynamic> chunks, Uint8List prefix) {
        final out = <int>[...prefix];
        for (final (i, c) in chunks.cast<Map<String, dynamic>>().indexed) {
          final chunk = DataChunk.decode(h(c['hex'] as String));
          expect(chunk.seq, i);
          expect(chunk.payload.length, c['payloadSize']);
          out.addAll(chunk.payload);
        }
        return Uint8List.fromList(out);
      }

      expect(assemble(s['chunksFromStart'] as List, Uint8List(0)), pel);
      final offset = s['resumeOffset'] as int;
      expect(assemble(s['chunksFromResume'] as List, pel.sublist(0, offset)), pel);

      // 앱 분할기도 같은 바이트를 만든다
      expect(splitIntoChunks(pel, 0).map((c) => toHex(c.encode())).toList(),
          (s['chunksFromStart'] as List).map((c) => (c as Map<String, dynamic>)['hex']).toList());

      final broken = h(((s['chunksFromStart'] as List).first as Map<String, dynamic>)['hex'] as String)..[10] ^= 0xff;
      expect(() => DataChunk.decode(broken), throwsA(isA<BleFormatException>()));
      expect(() => DataChunk.decode(Uint8List(3)), throwsA(isA<BleFormatException>()));
    });

    test('전송 완료 상태와 목록 항목(봉인 서명 포함)', () async {
      final status = TransferStatus.decode(h(s['transferComplete'] as String));
      expect(status.state, TransferState.complete);
      expect(status.sessionId, s['sessionId']);
      expect(status.totalBytes, pel.length);
      expect(status.sentBytes, pel.length);
      expect(status.crc32, crc32(pel));

      final idx = s['indexEntry'] as Map<String, dynamic>;
      final entry = SessionIndexEntry.decode(h(idx['hex'] as String));
      expect(entry.sessionId, s['sessionId']);
      expect(entry.trigger, 'shock');
      expect(entry.recordCount, s['recordCount']);
      expect(entry.byteLength, pel.length);
      expect(toHex(entry.finalHash), s['finalHash']);
      expect(toHex(entry.sealMessage(serial)), idx['sealMessage']);
      expect(await entry.verifySeal(serial, publicKey), isTrue);
      expect(await entry.verifySeal('PE-2026-000009', publicKey), isFalse);
    });
  });
}
