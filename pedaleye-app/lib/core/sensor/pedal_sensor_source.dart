/// 페달 센서 입력 인터페이스. 지금은 모의 센서만 있고, 단말 통신 규격이 정해지면
/// 같은 인터페이스의 BLE 구현을 만들어 끼운다(화면·계산 코드는 바꾸지 않는다).
library;

/// 듀얼 ToF 센서 한 번의 동시 측정값. 거리는 0.01mm 정수.
class RawPedalSample {
  const RawPedalSample({
    required this.sequenceId,
    required this.timestampMs,
    required this.accelRawDistance,
    required this.brakeRawDistance,
  });

  final int sequenceId;

  /// Unix epoch ms
  final int timestampMs;
  final int accelRawDistance;
  final int brakeRawDistance;
}

abstract interface class PedalSensorSource {
  /// 20Hz 원시 측정값. 여러 화면이 동시에 들을 수 있다(broadcast).
  Stream<RawPedalSample> get sampleStream;

  Future<void> initialize();

  Future<void> start();

  Future<void> stop();

  Future<void> dispose();
}

/// 센서 하나를 만드는 함수. 화면마다 새 연결을 연다.
typedef PedalSensorFactory = PedalSensorSource Function();
