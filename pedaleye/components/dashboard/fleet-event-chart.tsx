"use client";

import { ShieldCheck, Table } from "lucide-react";
import { useState } from "react";

import type { DailyEventStat } from "@/types/fleet-monitoring";

import { TRIGGER_SERIES } from "./fleet-labels";

const W = 720;
const H = 220;
const L = 32;
const B = 24;
const T = 10;

/** 일자별 이상 이벤트 누적 막대. 막대에 마우스·포커스를 두면 유형별 건수, 표로도 볼 수 있다. */
export function FleetEventChart({ stats }: { stats: readonly DailyEventStat[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const total = stats.reduce((sum, d) => sum + d.totalCount, 0);

  if (total === 0) {
    return (
      <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-border-strong bg-bg-base px-6 py-10 text-center" data-fleet-chart-empty>
        <ShieldCheck aria-hidden="true" size={28} className="text-text-muted" />
        <p className="m-0 font-semibold">선택한 기간 동안 발생한 이상 운전 및 경고 이벤트가 없습니다.</p>
        <p className="m-0 text-text-muted">안전하게 운행 중입니다.</p>
      </div>
    );
  }

  const max = Math.max(1, ...stats.map((d) => d.totalCount));
  const yMax = Math.max(2, Math.ceil(max / 2) * 2);
  const slot = (W - L - 8) / stats.length;
  const barW = Math.max(4, Math.min(36, slot - 4));
  const y = (v: number) => T + (H - T - B) * (1 - v / yMax);
  const labelEvery = stats.length > 10 ? 5 : 1;
  const active = hover !== null ? stats[hover] : undefined;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption font-medium" aria-label="범례">
          {TRIGGER_SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span aria-hidden="true" className={`size-3 rounded-sm ${s.bg}`} />
              {s.label}
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-secondary" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          <Table aria-hidden="true" size={18} />
          {asTable ? "차트로 보기" : "표로 보기"}
        </button>
      </div>

      {asTable ? (
        <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="일자별 이벤트 표" tabIndex={0}>
          <table className="w-full min-w-[480px] border-collapse text-left text-caption tabular-nums" data-fleet-table-view>
            <thead className="bg-bg-panel">
              <tr>
                <th scope="col" className="px-3 py-2">날짜</th>
                {TRIGGER_SERIES.map((s) => (
                  <th key={s.key} scope="col" className="px-3 py-2">{s.label}</th>
                ))}
                <th scope="col" className="px-3 py-2">합계</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((d) => (
                <tr key={d.date} className="odd:bg-bg-base even:bg-bg-panel/50">
                  <td className="px-3 py-1.5">{d.date}</td>
                  {TRIGGER_SERIES.map((s) => (
                    <td key={s.key} className="px-3 py-1.5">{d[s.key]}</td>
                  ))}
                  <td className="px-3 py-1.5 font-semibold">{d.totalCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative overflow-x-auto rounded-md border border-border bg-bg-base">
          <svg viewBox={`0 0 ${W} ${H}`} className={`block h-auto w-full ${stats.length > 14 ? "min-w-[480px]" : ""}`} role="img" aria-label={`최근 ${stats.length}일 일자별 이상 이벤트 ${total}건`}>
            {[0, yMax / 2, yMax].map((v) => (
              <g key={v}>
                <line x1={L} x2={W - 8} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
                <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} className="fill-text-muted">{v}</text>
              </g>
            ))}
            {stats.map((d, i) => {
              const cx = L + slot * i + slot / 2;
              let acc = 0;
              return (
                <g
                  key={d.date}
                  tabIndex={0}
                  role="button"
                  aria-label={`${d.date} 이벤트 ${d.totalCount}건`}
                  data-fleet-bar={d.date}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                >
                  {/* 막대보다 넓은 감지 영역 */}
                  <rect x={L + slot * i} y={T} width={slot} height={H - T - B} className={hover === i ? "fill-border/60" : "fill-transparent"} />
                  {TRIGGER_SERIES.map((s) => {
                    const v = d[s.key];
                    if (!v) return null;
                    const top = y(acc + v);
                    const h = y(acc) - top;
                    acc += v;
                    return <rect key={s.key} x={cx - barW / 2} y={top + 1} width={barW} height={Math.max(1, h - 2)} rx={2} className={s.fill} />;
                  })}
                  {i % labelEvery === 0 || i === stats.length - 1 ? (
                    <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} className="fill-text-muted">
                      {d.date.slice(5).replace("-", "/")}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {active ? (
            <div role="status" data-fleet-tooltip className="pointer-events-none absolute top-2 right-2 grid gap-0.5 rounded-md border border-border bg-bg-base p-3 text-caption shadow-md">
              <strong>{active.date} · 합계 {active.totalCount}건</strong>
              {TRIGGER_SERIES.map((s) => (
                <span key={s.key} className="flex items-center gap-2 tabular-nums">
                  <span aria-hidden="true" className={`size-2.5 rounded-sm ${s.bg}`} />
                  {s.label} {active[s.key]}건
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
