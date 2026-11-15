import '../../../core/telemetry/telemetry_controller.dart';

/// 운전자 본인 배정 차량에 장착된 단말
class DriverDevice {
  const DriverDevice({
    required this.deviceId,
    required this.serialNumber,
    required this.plateNumber,
    required this.calibration,
  });

  final String deviceId;
  final String serialNumber;
  final String plateNumber;
  final PedalCalibration calibration;

  /// 실시간 게이지를 쓰려면 보정이 끝나 있어야 한다
  bool get isCalibrated => !calibration.isFactoryDefault && calibration.isValid;
}
