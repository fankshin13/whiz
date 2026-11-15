import type { DecodedPacket, TriggerType, VerificationResult } from "./forensics";

export interface ForensicReportMetadata {
  reportNumber: string; // PEDAL-FORENSIC-{세션 ID 앞 8자리}
  generatedAt: string; // ISO 8601 (Asia/Seoul)
  organizationName: string;
  plateNumber: string;
  modelName: string;
  vinMasked: string | null;
  deviceSerialNumber: string;
  hardwareRev: string;
  firmwareVersion: string;
  accelStrokeMm: number;
  brakeStrokeMm: number;
}

export interface ForensicKeyStatistics {
  maxAccelPercent: number;
  maxBrakePercent: number;
  dualPressDurationSeconds: number;
  speedAtTriggerKmh: number;
  maxSpeedKmh: number;
  totalDurationSeconds: number;
}

export interface ForensicReportData {
  sessionId: string;
  metadata: ForensicReportMetadata;
  triggerType: TriggerType;
  startTime: string;
  endTime: string;
  triggerTimeMs: number; // T=0
  verification: VerificationResult;
  statistics: ForensicKeyStatistics;
  timeSeriesSample: DecodedPacket[]; // 인쇄용 다운샘플(최대 600점)
  dualRanges: Array<{ startMs: number; endMs: number }>; // 전체 패킷 기준 양발 구간
  auditLedgerSample: DecodedPacket[]; // 시작 3, 트리거 전후 5, 끝 3
}
