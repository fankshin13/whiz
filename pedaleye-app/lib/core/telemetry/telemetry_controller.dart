import 'dart:async';

import 'package:flutter/foundation.dart';

import '../sensor/pedal_sensor_source.dart';
import 'displacement_engine.dart';
import 'pedal_calculator.dart';
import 'telemetry_frame.dart';

/// 단말의 보정값 4개(0.01mm). max = 0% 유휴 거리, min = 100% 완전 답입 거리.
class PedalCalibration {
  const PedalCalibration({
    required this.accelCalibMin,
    required this.accelCalibMax,
    required this.brakeCalibMin,
    required this.brakeCalibMax,
  });

  final int accelCalibMin;
  final int accelCalibMax;
  final int brakeCalibMin;
  final int brakeCalibMax;

  /// 공장 기본값(0~4095) 그대로면 아직 캘리브레이션 전이다(웹 isFactoryCalibration 과 같음)
  bool get isFactoryDefault =>
      accelCalibMin == 0 && accelCalibMax == 4095 && brakeCalibMin == 0 && brakeCalibMax == 4095;

  bool get isValid => isValidStroke(accelCalibMin, accelCalibMax) && isValidStroke(brakeCalibMin, brakeCalibMax);
}

/// 센서 원시값 → 답입률·레벨·모드(TelemetryFrame). 3초 동안 값이 없으면 끊김으로 알린다.
/// 20Hz 로 바뀌는 값은 [frame] 하나에만 담아 게이지 영역만 다시 그리게 한다.
class TelemetryController {
  TelemetryController({required this.source, required this.calibration, this.timeout = const Duration(seconds: 3)});

  final PedalSensorSource source;
  final PedalCalibration calibration;
  final Duration timeout;

  final frame = ValueNotifier<TelemetryFrame?>(null);
  final disconnected = ValueNotifier<bool>(false);
  StreamSubscription<RawPedalSample>? _subscription;
  Timer? _watchdog;

  Future<void> start() async {
    _subscription ??= source.sampleStream.listen(_onSample);
    await source.initialize();
    await source.start();
    _armWatchdog();
  }

  /// 센서 연결을 다시 연다
  Future<void> reconnect() async {
    await source.stop();
    disconnected.value = false;
    await source.start();
    _armWatchdog();
  }

  void _onSample(RawPedalSample sample) {
    final accel = calculatePedalPercentage(
      sample.accelRawDistance,
      calibration.accelCalibMin,
      calibration.accelCalibMax,
    );
    final brake = calculatePedalPercentage(
      sample.brakeRawDistance,
      calibration.brakeCalibMin,
      calibration.brakeCalibMax,
    );
    frame.value = buildTelemetryFrame(sample.sequenceId, sample.timestampMs, accel, brake);
    disconnected.value = false;
    _armWatchdog();
  }

  void _armWatchdog() {
    _watchdog?.cancel();
    _watchdog = Timer(timeout, () => disconnected.value = true);
  }

  Future<void> dispose() async {
    _watchdog?.cancel();
    await _subscription?.cancel();
    await source.dispose();
    frame.dispose();
    disconnected.dispose();
  }
}
