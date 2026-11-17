import 'dart:async';

import '../../features/device/application/device_link_controller.dart';
import 'pedal_sensor_source.dart';

/// BLE 단말의 실시간 프레임(20Hz)을 기존 센서 인터페이스로 바꾼다. 화면·계산 코드는 모의 센서와 똑같이 쓴다.
/// 연결·재연결은 앱 전체가 공유하는 [DeviceLinkController] 가 맡는다(화면을 닫아도 연결은 유지).
class BlePedalSensorSource implements PedalSensorSource {
  BlePedalSensorSource(this._link);

  final DeviceLinkController _link;
  final _controller = StreamController<RawPedalSample>.broadcast();
  StreamSubscription<RealtimeFrame>? _subscription;

  DeviceLinkController get link => _link;

  @override
  Stream<RawPedalSample> get sampleStream => _controller.stream;

  @override
  Future<void> initialize() async {}

  @override
  Future<void> start() async {
    _subscription ??= _link.frames.listen(
      (frame) => _controller.add(
        RawPedalSample(
          sequenceId: frame.record.sequenceId,
          timestampMs: frame.record.timestampMs,
          accelRawDistance: frame.record.accelDistance,
          brakeRawDistance: frame.record.brakeDistance,
        ),
      ),
    );
  }

  @override
  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
  }

  @override
  Future<void> dispose() async {
    await stop();
    await _controller.close();
  }
}
