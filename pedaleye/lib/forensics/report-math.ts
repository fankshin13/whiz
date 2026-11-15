/** 보고서 통계·다운샘플링·감사표 선별(순수 함수). */
import type { ForensicKeyStatistics } from "@/types/forensic-report";
import type { DecodedPacket } from "@/types/forensics";

/**
 * 트리거(T=0) 위치. 기록기는 직전 30초 + 이후 30초로 세션을 만들므로 가운데 패킷이 트리거 시점이다.
 * (트리거 시각은 별도 저장하지 않으므로 세션 구조에서 정한다)
 */
export function triggerIndex(packets: readonly DecodedPacket[]): number {
  return Math.floor(packets.length / 2);
}

function sampleInterval(packets: readonly DecodedPacket[]): number {
  if (packets.length < 2) return 0;
  const first = packets[0]?.timestampUtc ?? 0;
  const last = packets[packets.length - 1]?.timestampUtc ?? 0;
  return (last - first) / (packets.length - 1);
}

export function computeStatistics(packets: readonly DecodedPacket[]): ForensicKeyStatistics {
  const interval = sampleInterval(packets);
  const first = packets[0];
  const last = packets[packets.length - 1];
  return {
    maxAccelPercent: Math.max(0, ...packets.map((p) => p.accelPercent)),
    maxBrakePercent: Math.max(0, ...packets.map((p) => p.brakePercent)),
    dualPressDurationSeconds: Math.round(((packets.filter((p) => p.bothPedalFlag).length * interval) / 1000) * 100) / 100,
    speedAtTriggerKmh: packets[triggerIndex(packets)]?.speedKmh ?? 0,
    maxSpeedKmh: Math.max(0, ...packets.map((p) => p.speedKmh)),
    totalDurationSeconds: first && last ? Math.round(((last.timestampUtc - first.timestampUtc + interval) / 1000) * 100) / 100 : 0,
  };
}

/**
 * 최소·최대 버킷 다운샘플링: 구간마다 가속·제동·차속의 최소·최대 지점을 남겨
 * 급제동 같은 순간 피크가 인쇄 그래프에서 사라지지 않게 한다.
 */
export function downsampleMinMax(packets: readonly DecodedPacket[], maxPoints = 600): DecodedPacket[] {
  if (packets.length <= maxPoints) return [...packets];
  const perBucket = 6; // 버킷당 최대 남기는 점 수
  const bucketCount = Math.floor(maxPoints / perBucket);
  const size = packets.length / bucketCount;
  const keep = new Set<number>([0, packets.length - 1]);
  for (let b = 0; b < bucketCount; b += 1) {
    const start = Math.floor(b * size);
    const end = Math.min(packets.length, Math.floor((b + 1) * size));
    for (const key of ["accelPercent", "brakePercent", "speedKmh"] as const) {
      let min = start;
      let max = start;
      for (let i = start; i < end; i += 1) {
        if ((packets[i]?.[key] ?? 0) < (packets[min]?.[key] ?? 0)) min = i;
        if ((packets[i]?.[key] ?? 0) > (packets[max]?.[key] ?? 0)) max = i;
      }
      keep.add(min);
      keep.add(max);
    }
  }
  return [...keep].sort((a, b) => a - b).flatMap((i) => (packets[i] ? [packets[i]] : []));
}

export function dualPressRanges(packets: readonly DecodedPacket[]): Array<{ startMs: number; endMs: number }> {
  const ranges: Array<{ startMs: number; endMs: number }> = [];
  let start: number | null = null;
  packets.forEach((p, i) => {
    if (p.bothPedalFlag && start === null) start = p.timestampUtc;
    const next = packets[i + 1];
    if (start !== null && (!next || !next.bothPedalFlag)) {
      ranges.push({ startMs: start, endMs: p.timestampUtc });
      start = null;
    }
  });
  return ranges;
}

/** 감사표: 시작 3, 트리거 전후 5(트리거 포함 −2~+2), 끝 3 */
export function selectLedger(packets: readonly DecodedPacket[]): DecodedPacket[] {
  const t = triggerIndex(packets);
  const indexes = new Set<number>();
  [0, 1, 2].forEach((i) => indexes.add(i));
  [-2, -1, 0, 1, 2].forEach((d) => indexes.add(t + d));
  [3, 2, 1].forEach((d) => indexes.add(packets.length - d));
  return [...indexes]
    .filter((i) => i >= 0 && i < packets.length)
    .sort((a, b) => a - b)
    .flatMap((i) => (packets[i] ? [packets[i]] : []));
}
