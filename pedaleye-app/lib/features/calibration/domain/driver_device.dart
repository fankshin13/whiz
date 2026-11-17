import 'dart:typed_data';

import '../../../core/telemetry/telemetry_controller.dart';

/// 운전자 본인 배정 차량에 장착된 단말
class DriverDevice {
  const DriverDevice({
    required this.deviceId,
    required this.serialNumber,
    required this.plateNumber,
    required this.calibration,
    this.authPublicKey,
  });

  final String deviceId;
  final String serialNumber;
  final String plateNumber;
  final PedalCalibration calibration;

  /// 서버에 등록된 단말 인증 공개키(Ed25519 32바이트). null = 인증 미설정(시험 단말)
  final Uint8List? authPublicKey;

  bool get hasAuthKey => authPublicKey != null;

  /// 실시간 게이지를 쓰려면 보정이 끝나 있어야 한다
  bool get isCalibrated => !calibration.isFactoryDefault && calibration.isValid;
}
