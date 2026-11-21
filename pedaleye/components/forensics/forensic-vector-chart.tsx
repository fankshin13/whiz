import type { ForensicReportData } from "@/types/forensic-report";

/*
 * A4 인쇄용 순수 SVG 차트(벡터, 확대해도 깨지지 않음). 흑백 출력에서도 구분되게
 * 가속 = 청색 파선 + 세모 표식, 제동 = 적색 굵은 실선 + 네모 표식, 양발 구간 = 주황 빗금.
 * 차속은 위치정보 미수집(BLE 규격 v1.1)으로 기록하지 않아 그리지 않는다.
 */
const W = 720;
const L = 40;
const R = 12;
const PEDAL_TOP = 14;
const PEDAL_H = 190;
const AXIS_Y = PEDAL_TOP + PEDAL_H + 8;
const H = AXIS_Y + 22;
const MARKERS = 12;

const clock = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function ForensicVectorChart({ report }: { report: ForensicReportData }) {
  const points = report.timeSeriesSample;
  const t0 = points[0]?.timestampUtc ?? 0;
  const t1 = points[points.length - 1]?.timestampUtc ?? t0 + 1;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const yP = (v: number) => PEDAL_TOP + PEDAL_H - (v / 100) * PEDAL_H;
  const path = (y: (i: number) => number) => points.map((p, i) => `${i ? "L" : "M"}${x(p.timestampUtc).toFixed(1)},${y(i).toFixed(1)}`).join("");
  const markerIdx = Array.from({ length: MARKERS }, (_, k) => Math.round((k / (MARKERS - 1)) * (points.length - 1)));
  const tT = report.triggerTimeMs;
  const ticks = Array.from({ length: 7 }, (_, i) => t0 + ((t1 - t0) * i) / 6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="사고 전후 페달 답입률 시계열 그래프" data-report-chart>
      <defs>
        <pattern id="dual-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="fill-dual-warning/25" />
          <line x1="0" y1="0" x2="0" y2="6" className="stroke-dual-warning" strokeWidth="2" />
        </pattern>
      </defs>

      {report.dualRanges.map((r) => (
        <rect key={r.startMs} x={x(r.startMs)} y={PEDAL_TOP} width={Math.max(2, x(r.endMs) - x(r.startMs))} height={AXIS_Y - PEDAL_TOP} fill="url(#dual-hatch)" data-report-dual />
      ))}

      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={yP(v)} y2={yP(v)} className="stroke-border" strokeWidth={0.75} />
          <text x={L - 5} y={yP(v) + 3} textAnchor="end" className="fill-text-muted" fontSize={9}>
            {v}%
          </text>
        </g>
      ))}
      <text x={L} y={PEDAL_TOP - 4} className="fill-text-main" fontSize={9} fontWeight={600}>
        페달 답입률(%)
      </text>

      <path d={path((i) => yP(points[i]?.accelPercent ?? 0))} fill="none" className="stroke-accel" strokeWidth={1.5} strokeDasharray="4 2" />
      <path d={path((i) => yP(points[i]?.brakePercent ?? 0))} fill="none" className="stroke-brake" strokeWidth={2.5} />
      {markerIdx.map((i) => {
        const p = points[i];
        if (!p) return null;
        const cx = x(p.timestampUtc);
        const ay = yP(p.accelPercent);
        const by = yP(p.brakePercent);
        return (
          <g key={i}>
            <path d={`M${cx},${ay - 4} L${cx + 4},${ay + 3} L${cx - 4},${ay + 3} Z`} className="fill-accel" />
            <rect x={cx - 3} y={by - 3} width={6} height={6} className="fill-brake" />
          </g>
        );
      })}


      {tT >= t0 && tT <= t1 ? (
        <g data-report-trigger>
          <line x1={x(tT)} x2={x(tT)} y1={PEDAL_TOP} y2={AXIS_Y} className="stroke-brake" strokeWidth={1.25} strokeDasharray="2 2" />
          <text x={x(tT) + 4} y={PEDAL_TOP + 10} className="fill-text-main" fontSize={9} fontWeight={700}>
            T=0 (트리거)
          </text>
        </g>
      ) : null}

      {ticks.map((t, i) => (
        <text key={t} x={x(t)} y={AXIS_Y + 14} textAnchor={i === 0 ? "start" : i === 6 ? "end" : "middle"} className="fill-text-muted" fontSize={9}>
          {clock.format(t)}
        </text>
      ))}
    </svg>
  );
}

/** 범례: 선 모양·표식까지 그대로 보여 흑백에서도 읽힌다 */
export function VectorChartLegend() {
  const item = "flex items-center gap-1.5";
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[9pt]" aria-label="범례">
      <li className={item}>
        <svg width="28" height="10" aria-hidden="true">
          <line x1="0" y1="5" x2="28" y2="5" className="stroke-accel" strokeWidth="1.5" strokeDasharray="4 2" />
          <path d="M14,1 L18,8 L10,8 Z" className="fill-accel" />
        </svg>
        가속 페달(파선·세모)
      </li>
      <li className={item}>
        <svg width="28" height="10" aria-hidden="true">
          <line x1="0" y1="5" x2="28" y2="5" className="stroke-brake" strokeWidth="2.5" />
          <rect x="11" y="2" width="6" height="6" className="fill-brake" />
        </svg>
        제동 페달(굵은 실선·네모)
      </li>
      <li className={item}>
        <svg width="16" height="10" aria-hidden="true">
          <rect width="16" height="10" fill="url(#dual-hatch)" className="stroke-dual-warning" />
        </svg>
        양발 동시 조작(빗금)
      </li>
      <li className={item}>
        <svg width="12" height="12" aria-hidden="true">
          <line x1="6" y1="0" x2="6" y2="12" className="stroke-brake" strokeWidth="1.25" strokeDasharray="2 2" />
        </svg>
        T=0 트리거 시점
      </li>
    </ul>
  );
}
