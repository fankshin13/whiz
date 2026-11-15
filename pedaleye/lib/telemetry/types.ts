// 실시간 텔레메트리 계약. 해시 체인 로깅·관제 집계도 같은 정의를 쓴다.

export type PedalLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type PedalOperationMode = "IDLE" | "ACCEL" | "BRAKE" | "DUAL_WARNING";

export interface TelemetryFrame {
  sequenceId: number;
  timestamp: number; // epoch ms
  accelPercent: number; // 0~100
  brakePercent: number; // 0~100
  accelLevel: PedalLevel;
  brakeLevel: PedalLevel;
  mode: PedalOperationMode;
  isDualPressed: boolean;
}

export interface LedHardwarePacket {
  header: 0xaa;
  accelBits: number; // 5비트 마스크 0b00000~0b11111
  brakeBits: number; // 5비트 마스크
  warningFlag: 0x00 | 0x01; // 0x01: 양발 동시 조작 점멸
  checksum: number; // XOR
}
