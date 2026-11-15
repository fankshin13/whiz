// 웹 tests/pedal-calculator.test.ts 와 같은 입력·기대값
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/core/telemetry/pedal_calculator.dart';
import 'package:pedaleye_app/core/telemetry/telemetry_frame.dart';

void main() {
  group('calculatePedalLevel (5단계)', () {
    const cases = <(num, int)>[
      (0, 0), (0.1, 1), (20, 1), (20.1, 2), (21, 2), (40, 2), (41, 3), //
      (60, 3), (61, 4), (80, 4), (81, 5), (100, 5), (-3, 0),
    ];
    for (final (percent, level) in cases) {
      test('$percent% → $level단계', () => expect(calculatePedalLevel(percent), level));
    }
  });

  group('determineOperationMode', () {
    test('둘 다 5% 초과면 양발 동시 조작 경고', () {
      expect(determineOperationMode(10, 20), (mode: PedalOperationMode.dualWarning, isDualPressed: true));
      expect(determineOperationMode(6, 6), (mode: PedalOperationMode.dualWarning, isDualPressed: true));
    });

    test('한쪽이 5% 이하면 단일 조작으로 본다(임계치 정확히 5% 포함)', () {
      expect(determineOperationMode(5, 50), (mode: PedalOperationMode.brake, isDualPressed: false));
      expect(determineOperationMode(85, 5), (mode: PedalOperationMode.accel, isDualPressed: false));
    });

    test('가속만·제동만·둘 다 0', () {
      expect(determineOperationMode(15, 0).mode, PedalOperationMode.accel);
      expect(determineOperationMode(0, 50).mode, PedalOperationMode.brake);
      expect(determineOperationMode(0, 0).mode, PedalOperationMode.idle);
    });
  });

  group('LED 직렬 프레임', () {
    test('가속 85% → 청색 5칸, 적색 소등', () {
      final bytes = encodeLedSerialFrame(buildTelemetryFrame(1, 0, 85, 0));
      expect(bytes, [0xAA, 0x1F, 0, 0xAA ^ 0x1F]);
    });

    test('가속에서 발을 떼고 제동 50% → 청색 즉시 소등, 적색 3칸', () {
      final packet = decodeLedSerialFrame(encodeLedSerialFrame(buildTelemetryFrame(2, 0, 0, 50)))!;
      expect((packet.accelBits, packet.brakeBits, packet.warningFlag), (0, 0x07, 0));
    });

    test('양발 동시 조작 → 경고 플래그만, 단일 색 점등 해제', () {
      final packet = decodeLedSerialFrame(encodeLedSerialFrame(buildTelemetryFrame(3, 0, 10, 20)))!;
      expect((packet.accelBits, packet.brakeBits, packet.warningFlag), (0, 0, 1));
    });

    test('헤더·체크섬이 틀린 프레임은 거부한다', () {
      final bytes = encodeLedSerialFrame(buildTelemetryFrame(4, 0, 15, 0));
      expect(decodeLedSerialFrame(Uint8List.fromList([0x00, ...bytes.sublist(1)])), isNull);
      final tampered = Uint8List.fromList(bytes);
      tampered[1] = 0x03;
      expect(decodeLedSerialFrame(tampered), isNull);
    });
  });
}
