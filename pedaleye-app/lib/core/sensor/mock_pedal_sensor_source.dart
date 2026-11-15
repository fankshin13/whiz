import 'dart:async';
import 'dart:math' as math;

import 'pedal_sensor_source.dart';

enum MockPedalScenario {
  /// 화면의 슬라이더로 직접 밟는 정도를 정한다(캘리브레이션 연습용)
  manual,

  /// 가속 → 쉼 → 제동 → 쉼 반복
  normalDrive,

  /// 짧은 간격으로 가속 페달을 끝까지 밟았다 뗌
  suddenAccel,

  /// 짧은 간격으로 제동 페달을 끝까지 밟았다 뗌
  suddenBrake,

  /// 가속 30% + 제동 40% 를 함께 밟음
  dualPedalWarning,

  /// 측정값 전송이 멈춤(재연결 전까지)
  sensorTimeout,
}

/// 실제 장착 거리와 비슷한 모의 차량 형상(0.01mm). 웹 시뮬레이터(SIMULATED_GEOMETRY)와 같은 값.
abstract final class MockPedalGeometry {
  static const accelIdle = 12050;
  static const accelFull = 8050;
  static const brakeIdle = 13000;
  static const brakeFull = 9500;
}

/// 50ms(20Hz)마다 거리값을 내보내는 모의 센서
class MockPedalSensorSource implements PedalSensorSource {
  MockPedalSensorSource({
    this.interval = const Duration(milliseconds: 50),
    this.noise = 5,
    math.Random? random,
    int Function()? clock,
  }) : _random = random ?? math.Random(),
       _clock = clock ?? (() => DateTime.now().millisecondsSinceEpoch);

  final Duration interval;

  /// ±0.05mm 센서 잡음
  final int noise;
  final math.Random _random;
  final int Function() _clock;
  final _controller = StreamController<RawPedalSample>.broadcast();
  Timer? _timer;
  int _sequence = 0;
  int _tick = 0;
  double _accelPress = 0;
  double _brakePress = 0;
  MockPedalScenario _scenario = MockPedalScenario.manual;

  MockPedalScenario get scenario => _scenario;

  @override
  Stream<RawPedalSample> get sampleStream => _controller.stream;

  void setScenario(MockPedalScenario scenario) {
    _scenario = scenario;
    _tick = 0;
  }

  /// manual 시나리오에서 밟는 정도(0~1)
  void setPress({double? accel, double? brake}) {
    if (accel != null) _accelPress = accel.clamp(0, 1).toDouble();
    if (brake != null) _brakePress = brake.clamp(0, 1).toDouble();
  }

  @override
  Future<void> initialize() async {}

  /// 다시 시작하면 끊김 시나리오도 풀린다(재연결)
  @override
  Future<void> start() async {
    if (_scenario == MockPedalScenario.sensorTimeout) setScenario(MockPedalScenario.manual);
    _timer?.cancel();
    _timer = Timer.periodic(interval, (_) => _emit());
  }

  @override
  Future<void> stop() async {
    _timer?.cancel();
    _timer = null;
  }

  @override
  Future<void> dispose() async {
    await stop();
    await _controller.close();
  }

  void _emit() {
    if (_scenario == MockPedalScenario.sensorTimeout) return;
    final (accel, brake) = _pressFor(_tick++);
    _controller.add(
      RawPedalSample(
        sequenceId: _sequence++,
        timestampMs: _clock(),
        accelRawDistance: _distance(MockPedalGeometry.accelIdle, MockPedalGeometry.accelFull, accel),
        brakeRawDistance: _distance(MockPedalGeometry.brakeIdle, MockPedalGeometry.brakeFull, brake),
      ),
    );
  }

  int _distance(int idle, int full, double ratio) {
    final jitter = noise == 0 ? 0 : _random.nextInt(noise * 2 + 1) - noise;
    return (idle - ratio * (idle - full)).round() + jitter;
  }

  /// 시나리오별 밟는 정도(0~1). tick 은 50ms 단위.
  (double, double) _pressFor(int tick) {
    final perSecond = 1000 ~/ interval.inMilliseconds;
    final t = tick / perSecond; // 초
    double ramp(double x) => (math.sin(x * math.pi)).clamp(0, 1).toDouble();
    switch (_scenario) {
      case MockPedalScenario.manual:
      case MockPedalScenario.sensorTimeout:
        return (_accelPress, _brakePress);
      case MockPedalScenario.normalDrive:
        final c = t % 8;
        if (c < 3) return (0.6 * ramp(c / 3), 0);
        if (c >= 4 && c < 6) return (0, 0.45 * ramp((c - 4) / 2));
        return (0, 0);
      case MockPedalScenario.suddenAccel:
        return (t % 4 < 2 ? 1 : 0, 0);
      case MockPedalScenario.suddenBrake:
        return (0, t % 4 < 2 ? 1 : 0);
      case MockPedalScenario.dualPedalWarning:
        return (0.3, 0.4);
    }
  }
}
