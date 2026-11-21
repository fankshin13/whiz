import type { DecodedPacket } from "@/types/forensics";

/** 차트·표에 넘기는 가벼운 패킷(해시는 표에서 축약해 쓴다) */
export interface ChartPoint {
  seq: number;
  t: number;
  accel: number;
  brake: number;
  accelMm: number;
  brakeMm: number;
  dual: boolean;
  hash: string;
}

export function toChartPoints(packets: readonly DecodedPacket[]): ChartPoint[] {
  return packets.map((p) => ({
    seq: p.sequenceId,
    t: p.timestampUtc,
    accel: p.accelPercent,
    brake: p.brakePercent,
    accelMm: p.accelDistanceMm,
    brakeMm: p.brakeDistanceMm,
    dual: p.bothPedalFlag,
    hash: p.calculatedHash,
  }));
}
