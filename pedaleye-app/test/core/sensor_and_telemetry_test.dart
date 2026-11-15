import 'dart:async';
import 'dart:math';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/core/sensor/mock_pedal_sensor_source.dart';
import 'package:pedaleye_app/core/sensor/pedal_sensor_source.dart';
import 'package:pedaleye_app/core/telemetry/telemetry_controller.dart';
import 'package:pedaleye_app/core/telemetry/telemetry_frame.dart';

const calibration = PedalCalibration(
  accelCalibMin: MockPedalGeometry.accelFull,
  accelCalibMax: MockPedalGeometry.accelIdle,
  brakeCalibMin: MockPedalGeometry.brakeFull,
  brakeCalibMax: MockPedalGeometry.brakeIdle,
);

/// 테스트가 직접 값을 넣는 센서
class ManualSource implements PedalSensorSource {
  final controller = StreamController<RawPedalSample>.broadcast(sync: true);
  int starts = 0;
  int stops = 0;
  int seq = 0;

  void emit(int accel, int brake) => controller.add(
    RawPedalSample(sequenceId: seq++, timestampMs: 0, accelRawDistance: accel, brakeRawDistance: brake),
  );

  @override
  Stream<RawPedalSample> get sampleStream => controller.stream;
  @override
  Future<void> initialize() async {}
  @override
  Future<void> start() async => starts += 1;
  @override
  Future<void> stop() async => stops += 1;
  @override
  Future<void> dispose() => controller.close();
}

void main() {
  group('MockPedalSensorSource', () {
    test('50ms 간격, 1초에 20개를 보내고 순번이 1씩 증가', () {
      fakeAsync((async) {
        final source = MockPedalSensorSource(noise: 0, clock: () => 0);
        final got = <RawPedalSample>[];
        source.sampleStream.listen(got.add);
        source.start();
        async.elapse(const Duration(seconds: 1));
        expect(got, hasLength(20));
        expect(got.map((s) => s.sequenceId), List.generate(20, (i) => i));
        // 아무것도 안 밟으면 유휴 거리
        expect(got.first.accelRawDistance, MockPedalGeometry.accelIdle);
        expect(got.first.brakeRawDistance, MockPedalGeometry.brakeIdle);
        source.stop();
      });
    });

    test('직접 조작: 끝까지 밟으면 완전 답입 거리, 잡음은 ±0.05mm 이내', () {
      fakeAsync((async) {
        final source = MockPedalSensorSource(random: Random(1));
        final got = <RawPedalSample>[];
        source.sampleStream.listen(got.add);
        source.setPress(accel: 1, brake: 0.5);
        source.start();
        async.elapse(const Duration(seconds: 1));
        for (final s in got) {
          expect((s.accelRawDistance - MockPedalGeometry.accelFull).abs(), lessThanOrEqualTo(5));
          expect((s.brakeRawDistance - 11250).abs(), lessThanOrEqualTo(5));
        }
      });
    });

    test('신호 끊김 시나리오는 전송을 멈추고, 다시 시작하면 재개', () {
      fakeAsync((async) {
        final source = MockPedalSensorSource(noise: 0);
        var count = 0;
        source.sampleStream.listen((_) => count++);
        source.start();
        async.elapse(const Duration(milliseconds: 500));
        expect(count, 10);
        source.setScenario(MockPedalScenario.sensorTimeout);
        async.elapse(const Duration(seconds: 4));
        expect(count, 10);
        source.start();
        async.elapse(const Duration(milliseconds: 500));
        expect(count, 20);
      });
    });
  });

  group('TelemetryController', () {
    test('원시 거리 → 답입률·레벨·모드(웹 계산식과 같음)', () {
      fakeAsync((async) {
        final source = ManualSource();
        final controller = TelemetryController(source: source, calibration: calibration);
        controller.start();
        async.flushMicrotasks();

        source.emit(10050, MockPedalGeometry.brakeIdle); // 가속 50%
        expect(controller.frame.value?.accelPercent, 50);
        expect(controller.frame.value?.accelLevel, 3);
        expect(controller.frame.value?.mode, PedalOperationMode.accel);

        source.emit(MockPedalGeometry.accelIdle, MockPedalGeometry.brakeFull); // 제동 100%
        expect(controller.frame.value?.mode, PedalOperationMode.brake);
        expect(controller.frame.value?.brakeLevel, 5);

        // 가속 30% + 제동 40% → 양발
        source.emit(12050 - 1200, 13000 - 1400);
        expect(controller.frame.value?.isDualPressed, isTrue);
        expect(controller.frame.value?.mode, PedalOperationMode.dualWarning);
      });
    });

    test('3초 동안 값이 없으면 끊김, 값이 오면 해제, 재연결은 센서를 다시 연다', () {
      fakeAsync((async) {
        final source = ManualSource();
        final controller = TelemetryController(source: source, calibration: calibration);
        controller.start();
        async.flushMicrotasks();
        source.emit(12050, 13000);

        async.elapse(const Duration(milliseconds: 2900));
        expect(controller.disconnected.value, isFalse);
        async.elapse(const Duration(milliseconds: 200));
        expect(controller.disconnected.value, isTrue);

        controller.reconnect();
        async.flushMicrotasks();
        expect(controller.disconnected.value, isFalse);
        expect((source.stops, source.starts), (1, 2));

        async.elapse(const Duration(seconds: 3));
        expect(controller.disconnected.value, isTrue);
        source.emit(12050, 13000);
        expect(controller.disconnected.value, isFalse);
      });
    });
  });

  test('공장 기본값(0~4095)은 미보정으로 본다', () {
    const factory = PedalCalibration(accelCalibMin: 0, accelCalibMax: 4095, brakeCalibMin: 0, brakeCalibMax: 4095);
    expect(factory.isFactoryDefault, isTrue);
    expect(calibration.isFactoryDefault, isFalse);
    expect(calibration.isValid, isTrue);
  });
}
