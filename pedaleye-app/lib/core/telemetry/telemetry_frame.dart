/// 실시간 텔레메트리 계약. 웹 lib/telemetry/types.ts 와 같다.
enum PedalOperationMode { idle, accel, brake, dualWarning }

class TelemetryFrame {
  const TelemetryFrame({
    required this.sequenceId,
    required this.timestampMs,
    required this.accelPercent,
    required this.brakePercent,
    required this.accelLevel,
    required this.brakeLevel,
    required this.mode,
    required this.isDualPressed,
  });

  final int sequenceId;
  final int timestampMs;

  /// 0~100
  final double accelPercent;
  final double brakePercent;

  /// 0~5
  final int accelLevel;
  final int brakeLevel;
  final PedalOperationMode mode;
  final bool isDualPressed;
}

/// LED 컨트롤러로 보내는 내용
class LedHardwarePacket {
  const LedHardwarePacket({
    required this.accelBits,
    required this.brakeBits,
    required this.warningFlag,
    required this.checksum,
  });

  final int header = ledHeader;

  /// 5비트 마스크 0b00000~0b11111
  final int accelBits;
  final int brakeBits;

  /// 1: 양발 동시 조작 점멸
  final int warningFlag;

  /// XOR
  final int checksum;
}

const ledHeader = 0xAA;
