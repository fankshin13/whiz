// 웹 tests/hash-chain.test.ts 와 같은 입력·기대값
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/core/forensics/event_recorder.dart';
import 'package:pedaleye_app/core/forensics/hash_chain.dart';
import 'package:pedaleye_app/core/forensics/packet_codec.dart';

const device = '40000000-0000-0000-0000-000000000001';
final start = DateTime.utc(2026, 11, 15).millisecondsSinceEpoch; // 2026-11-15 09:00 KST

PacketPayload payload(int i) => PacketPayload(
  sequenceId: i,
  timestampMs: start + i * 50,
  accelDistance: 10520,
  accelPercent: 38,
  brakeDistance: 13000,
  brakePercent: 0,
  bothPedal: false,
  latitudeE7: 375665000,
  longitudeE7: 1269780000,
  speedDeciKmh: 655,
);

Uint8List sessionOf(int count) => buildChainedSession(device, List.generate(count, payload));

PacketRecord withHash(
  PacketPayload p, {
  int? sequenceId,
  bool? bothPedal,
  int? latitudeE7,
  int? accelPercent,
  Uint8List? prevHash,
}) => PacketRecord(
  sequenceId: sequenceId ?? p.sequenceId,
  timestampMs: p.timestampMs,
  accelDistance: p.accelDistance,
  accelPercent: accelPercent ?? p.accelPercent,
  brakeDistance: p.brakeDistance,
  brakePercent: p.brakePercent,
  bothPedal: bothPedal ?? p.bothPedal,
  latitudeE7: latitudeE7 ?? p.latitudeE7,
  longitudeE7: p.longitudeE7,
  speedDeciKmh: p.speedDeciKmh,
  prevHash: prevHash ?? Uint8List(32),
);

void main() {
  group('64바이트 패킷 코덱 (Little-Endian)', () {
    test('모든 필드가 손실 없이 왕복한다', () {
      final record = withHash(
        payload(7),
        bothPedal: true,
        latitudeE7: -123456789,
        prevHash: Uint8List(32)..fillRange(0, 32, 0xAB),
      );
      final bytes = encodePacketRecord(record);
      expect(bytes.length, 64);
      final back = decodePacketRecord(bytes, 0);
      expect(
        [
          back.sequenceId,
          back.timestampMs,
          back.accelDistance,
          back.accelPercent,
          back.brakeDistance,
          back.brakePercent,
          back.bothPedal,
          back.latitudeE7,
          back.longitudeE7,
          back.speedDeciKmh,
          back.prevHash,
        ],
        [7, start + 350, 10520, 38, 13000, 0, true, -123456789, 1269780000, 655, record.prevHash],
      );
    });

    test('오프셋 배치가 명세와 같다', () {
      final bytes = encodePacketRecord(withHash(payload(0), sequenceId: 0x01020304));
      expect(bytes.sublist(0, 4), [0x04, 0x03, 0x02, 0x01]); // LE
      expect(bytes[12] | (bytes[13] << 8), 10520); // Accel_Distance
      expect(bytes[14], 38); // Accel_Percentage
      expect(bytes[19], 0); // Reserved
      expect(bytes[28] | (bytes[29] << 8), 655); // GPS_Speed_Kmh
    });

    test('범위를 벗어난 값은 거부한다', () {
      expect(() => encodePacketRecord(withHash(payload(0), accelPercent: 101)), throwsRangeError);
      expect(() => encodePacketRecord(withHash(payload(0), prevHash: Uint8List(31))), throwsRangeError);
    });
  });

  group('SHA-256 해시 체인', () {
    test('1,200개 정상 체인은 통과하고, 시작 해시는 제네시스와 같다', () {
      final bytes = sessionOf(1200);
      expect(bytes.length, 1200 * 64 + 32);
      final genesis = toHex(computeGenesisHash(device, start));
      final result = verifyBinaryHashChain(bytes, expectedInitialHash: genesis);
      expect((result.isValid, result.totalRecords, result.initialHash), (true, 1200, genesis));
      expect(result.finalHash, toHex(bytes.sublist(1200 * 64)));
    });

    test('패킷 #500 의 1비트 변조 → #501 에서 불일치', () {
      final bytes = sessionOf(1200);
      bytes[500 * 64 + 14] ^= 0x01;
      final r = verifyBinaryHashChain(bytes);
      expect((r.isValid, r.brokenSequenceId, r.reason), (false, 501, ChainBreakReason.prevHashMismatch));
    });

    test('어느 위치의 1바이트를 고쳐도 잡힌다(첫·마지막 패킷, 해시 영역, 끝 해시 포함)', () {
      final original = sessionOf(50);
      final genesis = toHex(computeGenesisHash(device, start));
      for (final position in [0, 14, 40, 63, 64 * 25 + 5, 64 * 49 + 3, 64 * 49 + 50, 50 * 64 + 10]) {
        final bytes = Uint8List.fromList(original);
        bytes[position] ^= 0x80;
        expect(
          verifyBinaryHashChain(bytes, expectedInitialHash: genesis).isValid,
          isFalse,
          reason: 'position $position',
        );
      }
    });

    test('마지막 패킷 변조는 끝 해시로 잡고 그 번호를 가리킨다', () {
      final bytes = sessionOf(10);
      bytes[9 * 64 + 14] ^= 0x01;
      final r = verifyBinaryHashChain(bytes);
      expect((r.isValid, r.brokenSequenceId, r.reason), (false, 9, ChainBreakReason.finalHashMismatch));
    });

    test('다른 단말·시작 시각의 제네시스와 다르면 거부', () {
      final other = toHex(computeGenesisHash('40000000-0000-0000-0000-000000000002', start));
      final r = verifyBinaryHashChain(sessionOf(5), expectedInitialHash: other);
      expect((r.isValid, r.reason), (false, ChainBreakReason.genesisMismatch));
    });

    test('길이가 64의 배수+32 가 아니면 형식 오류', () {
      final bytes = sessionOf(5);
      final r = verifyBinaryHashChain(Uint8List.sublistView(bytes, 0, bytes.length - 1));
      expect((r.isValid, r.reason), (false, ChainBreakReason.malformedLength));
    });

    test('웹(Node)과 같은 해시 값: 고정 입력의 제네시스·최종 해시', () {
      expect(toHex(computeGenesisHash(device, start)), webGenesis);
      expect(verifyBinaryHashChain(sessionOf(1200)).finalHash, webFinal1200);
    });
  });

  group('적응형 샘플링', () {
    test('페달 변화 2% 미만이면 1Hz, 밟거나 2% 이상 변하면 20Hz', () {
      final sampler = AdaptiveSampler();
      var idle = 0;
      for (var t = 0; t < 10000; t += 50) {
        if (sampler.shouldRecord(t, 0.5, 0)) idle++;
      }
      expect(idle, 10);
      expect(sampler.mode, SamplingMode.idle);
      var active = 0;
      for (var t = 10000; t < 20000; t += 50) {
        if (sampler.shouldRecord(t, 30, 0)) active++;
      }
      expect(active, 200);
      expect(sampler.mode, SamplingMode.active);
    });
  });

  group('트리거 감지', () {
    const base = SensorSample(timestampMs: 0, accelDistance: 0, accelPercent: 0, brakeDistance: 0, brakePercent: 0);
    SensorSample s({int t = 0, num brake = 0, double? g, double? ms2}) => SensorSample(
      timestampMs: t,
      accelDistance: 0,
      accelPercent: 0,
      brakeDistance: 0,
      brakePercent: brake,
      impactG: g,
      longitudinalMs2: ms2,
    );

    test('0.2초 안에 제동 80% 도달 → sudden_accel, 천천히 밟으면 아님', () {
      expect(detectTrigger([s(t: 850, brake: 10)], s(t: 1000, brake: 85)), TriggerType.suddenAccel);
      expect(detectTrigger([s(t: 500, brake: 10), s(t: 900, brake: 60)], s(t: 1000, brake: 85)), isNull);
    });

    test('충격 3.0G 초과 → shock, 감속 8m/s² → sudden_accel', () {
      expect(detectTrigger([], s(g: 3.2)), TriggerType.shock);
      expect(detectTrigger([], s(g: 3.0)), isNull);
      expect(detectTrigger([], s(ms2: -8.5)), TriggerType.suddenAccel);
      expect(detectTrigger([], base), isNull);
    });
  });

  group('단말 단독 사고 기록(BLE 미연결 시뮬레이션)', () {
    const drive = [
      DriveSegment(durationMs: 20000, accel: 0, brake: 0, speedKmh: 0), // 정차
      DriveSegment(durationMs: 40000, accel: 0.4, brake: 0, speedKmh: 50), // 주행
      DriveSegment(durationMs: 500, accel: 0, brake: 0, speedKmh: 50), // 발 뗌
      DriveSegment(durationMs: 40000, accel: 0, brake: 1, speedKmh: 0), // 급제동 이후
    ];

    test('급제동 → 직전 30초 + 이후 30초 = 1,200개 패킷, 50ms 간격 결락 없음, 체인 유효', () {
      final recorder = EventRecorder(device);
      for (final sample in mockPedalHardwareStream(drive, start)) {
        recorder.ingest(sample);
        if (recorder.state == RecorderState.frozen) break;
      }
      expect(recorder.state, RecorderState.frozen);
      final session = recorder.freeze();
      expect(session.triggerType, TriggerType.suddenAccel);
      expect(session.recordCount, 1200);
      expect(session.bytes.length, 1200 * 64 + 32);
      expect(session.triggerAtMs - session.startTimeMs, 30000);
      expect(session.endTimeMs - session.triggerAtMs, 29950);
      for (var i = 1; i < 1200; i++) {
        final gap =
            decodePacketRecord(session.bytes, i * 64).timestampMs -
            decodePacketRecord(session.bytes, (i - 1) * 64).timestampMs;
        expect(gap, 50);
      }
      expect(decodePacketRecord(session.bytes, 600 * 64).brakePercent, 100);
      expect(decodePacketRecord(session.bytes, 599 * 64).brakePercent, 0);
      final genesis = toHex(computeGenesisHash(device, session.startTimeMs));
      final r = verifyBinaryHashChain(session.bytes, expectedInitialHash: genesis);
      expect((r.isValid, r.totalRecords), (true, 1200));
    });

    test('수동 백업 버튼으로도 60초 세션을 만든다', () {
      final recorder = EventRecorder(device);
      var count = 0;
      for (final sample in mockPedalHardwareStream([
        const DriveSegment(durationMs: 120000, accel: 0.2, brake: 0, speedKmh: 30),
      ], start)) {
        recorder.ingest(sample);
        count++;
        if (count == 900) recorder.pressManualButton();
        if (recorder.state == RecorderState.frozen) break;
      }
      final session = recorder.freeze();
      expect(session.triggerType, TriggerType.manual);
      expect(session.recordCount, 1200);
    });

    test('평시 정차 중에는 1Hz 로만 플래시 로그에 남긴다', () {
      final recorder = EventRecorder(device);
      for (final sample in mockPedalHardwareStream([
        const DriveSegment(durationMs: 10000, accel: 0, brake: 0, speedKmh: 0),
      ], start)) {
        recorder.ingest(sample);
      }
      expect(recorder.routineRecorded, 10);
      expect(recorder.state, RecorderState.idle);
    });

    test('50Hz 설정이면 60초 3,000개', () {
      final recorder = EventRecorder(device, rateHz: 50);
      var count = 0;
      for (final sample in mockPedalHardwareStream(
        [const DriveSegment(durationMs: 120000, accel: 0.2, brake: 0, speedKmh: 30)],
        start,
        rateHz: 50,
      )) {
        recorder.ingest(sample);
        count++;
        if (count == 2000) recorder.pressManualButton();
        if (recorder.state == RecorderState.frozen) break;
      }
      expect(recorder.freeze().recordCount, 3000);
    });
  });
}

// 웹 lib/telemetry/hash-chain-engine.ts(Node Web Crypto)로 같은 입력을 계산한 값
const webGenesis = '8023ca732d715fb1e9d9957946a36db8bc9135f866152dbcb70de7b3e2ae43f9';
const webFinal1200 = 'c93ebb05b407640dc2dd4a65c70eeb96e585dd6c877bf0f4f9704a784f24fd7d';
