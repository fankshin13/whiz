"use client";

import { useState } from "react";

import type { ChartPoint } from "./chart-point";
import { formatSeoulTime, shortHash } from "./integrity-badge";

const PAGE_SIZE = 50;

/** 차트와 같은 데이터를 표로 제공(색 없이도 읽을 수 있는 대체 보기). */
export function PacketGrid({ points, highlightSeq }: { points: readonly ChartPoint[]; highlightSeq?: number }) {
  const initialPage = highlightSeq !== undefined ? Math.floor(Math.max(0, points.findIndex((p) => p.seq === highlightSeq)) / PAGE_SIZE) : 0;
  const [page, setPage] = useState(initialPage);
  const pages = Math.max(1, Math.ceil(points.length / PAGE_SIZE));
  const rows = points.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="패킷 데이터 표" tabIndex={0}>
        <table className="w-full min-w-[720px] border-collapse text-left text-caption tabular-nums">
          <thead className="bg-bg-panel">
            <tr>
              {["시퀀스", "시각(서울)", "가속", "제동", "양발", "차속", "패킷 해시"].map((label) => (
                <th key={label} scope="col" className="border-b border-border px-3 py-2 font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.seq} className={p.seq === highlightSeq ? "bg-critical-bg font-semibold" : "odd:bg-bg-base even:bg-bg-panel/50"}>
                <td className="px-3 py-1.5">#{p.seq}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{formatSeoulTime(p.t)}</td>
                <td className="px-3 py-1.5">{p.accel}%</td>
                <td className="px-3 py-1.5">{p.brake}%</td>
                <td className="px-3 py-1.5">{p.dual ? "동시" : "-"}</td>
                <td className="px-3 py-1.5">{p.speed.toFixed(1)}</td>
                <td className="px-3 py-1.5 font-mono">{shortHash(p.hash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-caption text-text-muted" aria-live="polite">
          {page + 1} / {pages} 쪽 · 전체 {points.length.toLocaleString("ko-KR")}개
        </span>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => setPage((v) => Math.max(0, v - 1))} disabled={page === 0}>
            이전
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setPage((v) => Math.min(pages - 1, v + 1))} disabled={page >= pages - 1}>
            다음
          </button>
        </div>
      </div>
    </div>
  );
}
