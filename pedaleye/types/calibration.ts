// 캘리브레이션 데이터 계약. 거리 단위는 모두 0.01mm 정수(예: 120.50mm → 12050).

export interface DeviceCalibrationData {
  deviceId: string;
  vehicleId: string;
  plateNumber: string;
  serialNumber: string;
  accelCalibMin: number; // 100% 완전 답입 시 거리
  accelCalibMax: number; // 0% 유휴 시 거리
  brakeCalibMin: number;
  brakeCalibMax: number;
  lastSyncedAt: string | null;
}

export interface CalibrationPayload {
  deviceId: string;
  accelCalibMin: number;
  accelCalibMax: number;
  brakeCalibMin: number;
  brakeCalibMax: number;
}

export interface SensorReadingSample {
  rawDistance: number; // 0.01mm
  timestamp: number; // epoch ms
}

/** 듀얼 ToF 센서 한 번의 동시 측정값 */
export interface DualPedalReading {
  accelDistance: number; // 0.01mm
  brakeDistance: number; // 0.01mm
  timestamp: number;
}
