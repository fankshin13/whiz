// 포렌식 검증·시각화 계약. PDF 보고서 생성기도 같은 정의를 쓴다.

export type TriggerType = "shock" | "sudden_accel" | "manual" | "periodic";

export interface DecodedPacket {
  sequenceId: number;
  timestampUtc: number; // epoch ms
  timestampIso: string; // ISO 8601, Asia/Seoul(+09:00)
  accelDistanceMm: number; // 0.01mm 해상도
  accelPercent: number;
  brakeDistanceMm: number;
  brakePercent: number;
  bothPedalFlag: boolean;
  latitude: number;
  longitude: number;
  speedKmh: number;
  prevRecordHash: string; // hex 64
  calculatedHash: string; // hex 64
}

export interface HashVerificationFailureDetail {
  failedSequenceId: number;
  timestampUtc: number;
  expectedHash: string; // 체인에서 요구되는 해시
  actualHash: string; // 파일에 기록된 해시
  reason: string;
}

export interface VerificationResult {
  isValid: boolean;
  totalRecords: number;
  initialHash: string;
  finalHash: string;
  failureDetail?: HashVerificationFailureDetail;
  verificationDurationMs: number;
}

export interface SessionForensicData {
  sessionId: string;
  deviceId: string;
  deviceSerialNumber: string;
  plateNumber: string;
  triggerType: TriggerType;
  startTime: string;
  endTime: string;
  verification: VerificationResult;
  /** 단말 봉인 서명: verified 확인됨 · invalid 불일치 · none 앱이 만든 기록(봉인 없음) */
  deviceSealed?: "verified" | "invalid" | "none";
  packets: DecodedPacket[];
}
