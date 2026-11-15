/**
 * 답입률 → LED 5단계 레벨·조작 모드 판정, USB LED 직렬 프레임 인코딩.
 * 순수 함수만 두어 단말 펌웨어·모바일 앱으로 그대로 옮길 수 있게 한다.
 */
import type { LedHardwarePacket, PedalLevel, PedalOperationMode, TelemetryFrame } from "@/lib/telemetry/types";

export const DUAL_PRESS_THRESHOLD = 5; // 양발 동시 조작 판정 임계치(%)
export const LED_HEADER = 0xaa;

/** 0% 이하 0, (0,20] 1, (20,40] 2, (40,60] 3, (60,80] 4, (80,100] 5 */
export function calculatePedalLevel(percent: number): PedalLevel {
  if (percent <= 0) return 0;
  if (percent <= 20) return 1;
  if (percent <= 40) return 2;
  if (percent <= 60) return 3;
  if (percent <= 80) return 4;
  return 5;
}

export function determineOperationMode(
  accelPercent: number,
  brakePercent: number,
): { mode: PedalOperationMode; isDualPressed: boolean } {
  if (accelPercent > DUAL_PRESS_THRESHOLD && brakePercent > DUAL_PRESS_THRESHOLD) {
    return { mode: "DUAL_WARNING", isDualPressed: true };
  }
  if (brakePercent > 0 && accelPercent <= DUAL_PRESS_THRESHOLD) return { mode: "BRAKE", isDualPressed: false };
  if (accelPercent > 0 && brakePercent <= DUAL_PRESS_THRESHOLD) return { mode: "ACCEL", isDualPressed: false };
  return { mode: "IDLE", isDualPressed: false };
}

export function buildTelemetryFrame(
  sequenceId: number,
  timestamp: number,
  accelPercent: number,
  brakePercent: number,
): TelemetryFrame {
  const { mode, isDualPressed } = determineOperationMode(accelPercent, brakePercent);
  return {
    sequenceId,
    timestamp,
    accelPercent,
    brakePercent,
    accelLevel: calculatePedalLevel(accelPercent),
    brakeLevel: calculatePedalLevel(brakePercent),
    mode,
    isDualPressed,
  };
}

/** 레벨 n → 아래쪽 n개 비트 켜짐(예: 3 → 0b00111) */
function levelBits(level: PedalLevel): number {
  return (1 << level) - 1;
}

/**
 * LED 바에 실제로 켤 내용. 제동 모드면 청색을 끄고(제동 우선), 가속 모드면 적색을 끈다.
 * 양발 동시 조작이면 경고 플래그만 세우고 컨트롤러가 전체 주황 점멸을 한다.
 */
export function toLedPacket(frame: TelemetryFrame): LedHardwarePacket {
  const warningFlag = frame.mode === "DUAL_WARNING" ? 0x01 : 0x00;
  const accelBits = frame.mode === "ACCEL" ? levelBits(frame.accelLevel) : 0;
  const brakeBits = frame.mode === "BRAKE" ? levelBits(frame.brakeLevel) : 0;
  const body = [LED_HEADER, accelBits, brakeBits | (warningFlag << 7)];
  return {
    header: LED_HEADER,
    accelBits,
    brakeBits,
    warningFlag,
    checksum: body.reduce((acc, byte) => acc ^ byte, 0),
  };
}

/** 4바이트 직렬 프레임: [0xAA, 가속 비트, 제동 비트 | 경고<<7, XOR 체크섬] */
export function encodeLedSerialFrame(frame: TelemetryFrame): Uint8Array {
  const packet = toLedPacket(frame);
  return Uint8Array.from([packet.header, packet.accelBits, packet.brakeBits | (packet.warningFlag << 7), packet.checksum]);
}

/** 컨트롤러 측 해석(테스트·펌웨어 대조용). 헤더·체크섬이 틀리면 null. */
export function decodeLedSerialFrame(bytes: Uint8Array): LedHardwarePacket | null {
  if (bytes.length !== 4 || bytes[0] !== LED_HEADER) return null;
  const [header, accelBits = 0, brakeByte = 0, checksum = 0] = bytes;
  if (((header ?? 0) ^ accelBits ^ brakeByte) !== checksum) return null;
  return {
    header: LED_HEADER,
    accelBits,
    brakeBits: brakeByte & 0x1f,
    warningFlag: brakeByte & 0x80 ? 0x01 : 0x00,
    checksum,
  };
}
