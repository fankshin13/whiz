/// 답입률 → LED 5단계 레벨·조작 모드 판정, LED 직렬 프레임. 웹 lib/telemetry/pedal-calculator.ts 와 같다.
library;

import 'dart:typed_data';

import 'telemetry_frame.dart';

/// 양발 동시 조작 판정 임계치(%)
const dualPressThreshold = 5;

/// 0% 이하 0, (0,20] 1, (20,40] 2, (40,60] 3, (60,80] 4, (80,100] 5
int calculatePedalLevel(num percent) {
  if (percent <= 0) return 0;
  if (percent <= 20) return 1;
  if (percent <= 40) return 2;
  if (percent <= 60) return 3;
  if (percent <= 80) return 4;
  return 5;
}

({PedalOperationMode mode, bool isDualPressed}) determineOperationMode(num accelPercent, num brakePercent) {
  if (accelPercent > dualPressThreshold && brakePercent > dualPressThreshold) {
    return (mode: PedalOperationMode.dualWarning, isDualPressed: true);
  }
  if (brakePercent > 0 && accelPercent <= dualPressThreshold) {
    return (mode: PedalOperationMode.brake, isDualPressed: false);
  }
  if (accelPercent > 0 && brakePercent <= dualPressThreshold) {
    return (mode: PedalOperationMode.accel, isDualPressed: false);
  }
  return (mode: PedalOperationMode.idle, isDualPressed: false);
}

TelemetryFrame buildTelemetryFrame(int sequenceId, int timestampMs, num accelPercent, num brakePercent) {
  final (:mode, :isDualPressed) = determineOperationMode(accelPercent, brakePercent);
  return TelemetryFrame(
    sequenceId: sequenceId,
    timestampMs: timestampMs,
    accelPercent: accelPercent.toDouble(),
    brakePercent: brakePercent.toDouble(),
    accelLevel: calculatePedalLevel(accelPercent),
    brakeLevel: calculatePedalLevel(brakePercent),
    mode: mode,
    isDualPressed: isDualPressed,
  );
}

/// 레벨 n → 아래쪽 n개 비트 켜짐(예: 3 → 0b00111)
int _levelBits(int level) => (1 << level) - 1;

/// LED 바에 실제로 켤 내용. 제동 모드면 청색을 끄고(제동 우선), 가속 모드면 적색을 끈다.
/// 양발 동시 조작이면 경고 플래그만 세우고 컨트롤러가 전체 주황 점멸을 한다.
LedHardwarePacket toLedPacket(TelemetryFrame frame) {
  final warningFlag = frame.mode == PedalOperationMode.dualWarning ? 0x01 : 0x00;
  final accelBits = frame.mode == PedalOperationMode.accel ? _levelBits(frame.accelLevel) : 0;
  final brakeBits = frame.mode == PedalOperationMode.brake ? _levelBits(frame.brakeLevel) : 0;
  return LedHardwarePacket(
    accelBits: accelBits,
    brakeBits: brakeBits,
    warningFlag: warningFlag,
    checksum: ledHeader ^ accelBits ^ (brakeBits | (warningFlag << 7)),
  );
}

/// 4바이트 직렬 프레임: [0xAA, 가속 비트, 제동 비트 | 경고<<7, XOR 체크섬]
Uint8List encodeLedSerialFrame(TelemetryFrame frame) {
  final p = toLedPacket(frame);
  return Uint8List.fromList([p.header, p.accelBits, p.brakeBits | (p.warningFlag << 7), p.checksum]);
}

/// 컨트롤러 측 해석(테스트·펌웨어 대조용). 헤더·체크섬이 틀리면 null.
LedHardwarePacket? decodeLedSerialFrame(Uint8List bytes) {
  if (bytes.length != 4 || bytes[0] != ledHeader) return null;
  final [header, accelBits, brakeByte, checksum] = bytes;
  if ((header ^ accelBits ^ brakeByte) != checksum) return null;
  return LedHardwarePacket(
    accelBits: accelBits,
    brakeBits: brakeByte & 0x1F,
    warningFlag: (brakeByte & 0x80) != 0 ? 0x01 : 0x00,
    checksum: checksum,
  );
}
