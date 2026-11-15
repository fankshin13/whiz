"use client";

import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { ChartPoint } from "./chart-point";

/*
 * 포렌식 시계열 차트. 페달 답입률(0~100%)과 차속(km/h)은 단위가 달라 한 축에 겹치지 않고
 * 위아래 두 패널로 나눈 뒤 같은 시간축·커서를 공유한다(이중 축 금지).
 * 드래그로 구간 확대, 버튼·키보드(←/→ 커서, +/− 확대·축소, 0 전체)로 조작한다.
 */

const PAD = { left: 44, right: 16, top: 12, bottom: 8 };
const PEDAL_H = 220;
const SPEED_H = 110;
const AXIS_H = 28;
const GAP = 16;
const MIN_WIDTH = 560;
const MIN_SPAN = 20; // 최소 20패킷(1초)까지 확대

const clockFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const clockMs = (t: number) => `${clockFormat.format(t)}.${String(t % 1000).padStart(3, "0")}`;

function linePath(points: readonly ChartPoint[], x: (p: ChartPoint) => number, y: (p: ChartPoint) => number) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p).toFixed(1)},${y(p).toFixed(1)}`).join("");
}

export function ForensicChart({ points }: { points: readonly ChartPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [view, setView] = useState<[number, number]>([0, Math.max(0, points.length - 1)]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(MIN_WIDTH, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const [from, to] = view;
  const visible = useMemo(() => points.slice(from, to + 1), [points, from, to]);
  const plotW = width - PAD.left - PAD.right;
  const t0 = visible[0]?.t ?? 0;
  const t1 = visible[visible.length - 1]?.t ?? t0 + 1;
  const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * plotW;
  const pedalTop = PAD.top;
  const speedTop = pedalTop + PEDAL_H + GAP;
  const axisTop = speedTop + SPEED_H;
  const height = axisTop + AXIS_H + PAD.bottom;
  const maxSpeed = Math.max(10, Math.ceil(Math.max(...visible.map((p) => p.speed), 0) / 10) * 10);
  const yPedal = (v: number) => pedalTop + PEDAL_H - (v / 100) * PEDAL_H;
  const ySpeed = (v: number) => speedTop + SPEED_H - (v / maxSpeed) * SPEED_H;

  // 양발 동시 조작 연속 구간
  const dualBands = useMemo(() => {
    const bands: Array<[number, number]> = [];
    let start: number | null = null;
    visible.forEach((p, i) => {
      if (p.dual && start === null) start = p.t;
      const next = visible[i + 1];
      if (start !== null && (!next || !next.dual)) {
        bands.push([start, p.t]);
        start = null;
      }
    });
    return bands;
  }, [visible]);

  const indexAt = (clientX: number): number => {
    const rect = wrapRef.current?.querySelector("svg")?.getBoundingClientRect();
    if (!rect || visible.length === 0) return from;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - PAD.left) / plotW));
    const target = t0 + ratio * (t1 - t0);
    let best = 0;
    for (let i = 0; i < visible.length; i += 1) {
      if (Math.abs((visible[i]?.t ?? 0) - target) < Math.abs((visible[best]?.t ?? 0) - target)) best = i;
    }
    return from + best;
  };

  const zoom = (factor: number, center = cursor ?? Math.round((from + to) / 2)) => {
    const span = Math.min(points.length - 1, Math.max(MIN_SPAN, Math.round((to - from) * factor)));
    let start = Math.round(center - span / 2);
    start = Math.max(0, Math.min(points.length - 1 - span, start));
    setView([start, start + span]);
  };
  const pan = (direction: -1 | 1) => {
    const span = to - from;
    const shift = Math.max(1, Math.round(span / 4)) * direction;
    const start = Math.max(0, Math.min(points.length - 1 - span, from + shift));
    setView([start, start + span]);
  };
  const reset = () => setView([0, points.length - 1]);

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const index = indexAt(event.clientX);
    if (event.pointerType === "touch") {
      setCursor(index); // 터치는 탭한 시점에 커서, 드래그는 가로 스크롤
      return;
    }
    setDrag({ from: index, to: index });
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const index = indexAt(event.clientX);
    setCursor(index);
    if (drag) setDrag({ from: drag.from, to: index });
  };
  const onPointerUp = () => {
    if (drag && Math.abs(drag.to - drag.from) >= MIN_SPAN) {
      setView([Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)]);
    }
    setDrag(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = cursor ?? from;
    if (event.key === "ArrowRight") setCursor(Math.min(to, current + 1));
    else if (event.key === "ArrowLeft") setCursor(Math.max(from, current - 1));
    else if (event.key === "+" || event.key === "=") zoom(0.5);
    else if (event.key === "-") zoom(2);
    else if (event.key === "0") reset();
    else return;
    event.preventDefault();
  };

  const point = cursor !== null && cursor >= from && cursor <= to ? points[cursor] : undefined;
  const xTicks = Array.from({ length: 5 }, (_, i) => t0 + ((t1 - t0) * i) / 4);
  const tooltipLeft = point ? Math.min(Math.max(x(point.t) + 12, 8), width - 220) : 0;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption font-medium" aria-label="범례">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-0.5 w-5 rounded-full bg-accel" />
            가속 페달(%)
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-0.5 w-5 rounded-full bg-brake" />
            제동 페달(%)
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-3 rounded-sm bg-dual-warning/40 ring-1 ring-dual-warning" />
            양발 동시 조작 구간
          </li>
        </ul>
        <div className="flex flex-wrap gap-2" role="group" aria-label="타임라인 조작">
          <button type="button" className="btn btn-secondary px-0" aria-label="왼쪽으로 이동" onClick={() => pan(-1)} disabled={from === 0}>
            <ChevronLeft aria-hidden="true" size={20} />
          </button>
          <button type="button" className="btn btn-secondary px-0" aria-label="확대" onClick={() => zoom(0.5)} disabled={to - from <= MIN_SPAN}>
            <ZoomIn aria-hidden="true" size={20} />
          </button>
          <button type="button" className="btn btn-secondary px-0" aria-label="축소" onClick={() => zoom(2)} disabled={from === 0 && to === points.length - 1}>
            <ZoomOut aria-hidden="true" size={20} />
          </button>
          <button type="button" className="btn btn-secondary px-0" aria-label="전체 구간 보기" onClick={reset} disabled={from === 0 && to === points.length - 1}>
            <Maximize2 aria-hidden="true" size={18} />
          </button>
          <button type="button" className="btn btn-secondary px-0" aria-label="오른쪽으로 이동" onClick={() => pan(1)} disabled={to === points.length - 1}>
            <ChevronRight aria-hidden="true" size={20} />
          </button>
        </div>
      </div>

      <p className="m-0 text-caption text-text-muted">
        표시 구간 {clockMs(t0)} ~ {clockMs(t1)} · {(to - from + 1).toLocaleString("ko-KR")}개 패킷. 차트를 드래그하면 그
        구간을 확대하고, 차트를 선택한 뒤 ←/→ 로 커서, +/− 로 확대·축소, 0 으로 전체 보기를 할 수 있습니다.
      </p>

      {/* 좁은 화면에서는 차트만 가로 스크롤 */}
      <div className="overflow-x-auto rounded-md border border-border bg-bg-base">
        <div
          ref={wrapRef}
          className="relative min-w-[560px]"
          tabIndex={0}
          role="application"
          aria-label="포렌식 시계열 차트. 화살표 키로 시점을 이동합니다."
          onKeyDown={onKeyDown}
          data-chart-from={from}
          data-chart-to={to}
        >
          <svg
            width={width}
            height={height}
            className="block touch-pan-x select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => {
              setDrag(null);
            }}
            role="img"
            aria-label="가속·제동 페달 답입률과 차속 시계열"
          >
            {/* 양발 구간 배경(두 패널 공통) */}
            {dualBands.map(([a, b]) => (
              <rect
                key={`${a}-${b}`}
                data-dual-band
                x={x(a) - 1}
                y={pedalTop}
                width={Math.max(2, x(b) - x(a) + 2)}
                height={axisTop - pedalTop}
                className="fill-dual-warning/30"
              />
            ))}

            {/* 페달 패널 격자·축 */}
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={width - PAD.right} y1={yPedal(v)} y2={yPedal(v)} className="stroke-border" strokeWidth={1} />
                <text x={PAD.left - 6} y={yPedal(v) + 4} textAnchor="end" className="fill-text-muted text-[11px] tabular-nums">
                  {v}%
                </text>
              </g>
            ))}
            <text x={PAD.left} y={pedalTop - 2} className="fill-text-muted text-[11px] font-semibold">
              페달 답입률
            </text>
            <path d={linePath(visible, (p) => x(p.t), (p) => yPedal(p.accel))} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-accel" />
            <path d={linePath(visible, (p) => x(p.t), (p) => yPedal(p.brake))} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-brake" />

            {/* 차속 패널 */}
            {[0, maxSpeed / 2, maxSpeed].map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={width - PAD.right} y1={ySpeed(v)} y2={ySpeed(v)} className="stroke-border" strokeWidth={1} />
                <text x={PAD.left - 6} y={ySpeed(v) + 4} textAnchor="end" className="fill-text-muted text-[11px] tabular-nums">
                  {v}
                </text>
              </g>
            ))}
            <text x={PAD.left} y={speedTop - 2} className="fill-text-muted text-[11px] font-semibold">
              차속(km/h)
            </text>
            <path d={linePath(visible, (p) => x(p.t), (p) => ySpeed(p.speed))} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-text-muted" />

            {/* 시간축 */}
            {xTicks.map((t, i) => (
              <text
                key={t}
                x={x(t)}
                y={axisTop + 18}
                textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}
                className="fill-text-muted text-[11px] tabular-nums"
              >
                {clockFormat.format(t)}
              </text>
            ))}

            {/* 드래그 선택 영역 */}
            {drag && drag.from !== drag.to ? (
              <rect
                x={x(points[Math.min(drag.from, drag.to)]?.t ?? t0)}
                y={pedalTop}
                width={Math.abs(x(points[drag.to]?.t ?? t0) - x(points[drag.from]?.t ?? t0))}
                height={axisTop - pedalTop}
                className="fill-primary-action/10 stroke-primary-action"
                strokeDasharray="4 3"
              />
            ) : null}

            {/* 커서 */}
            {point ? (
              <g pointerEvents="none">
                <line x1={x(point.t)} x2={x(point.t)} y1={pedalTop} y2={axisTop} className="stroke-text-main" strokeWidth={1} />
                <circle cx={x(point.t)} cy={yPedal(point.accel)} r={4} className="fill-accel stroke-bg-base" strokeWidth={2} />
                <circle cx={x(point.t)} cy={yPedal(point.brake)} r={4} className="fill-brake stroke-bg-base" strokeWidth={2} />
                <circle cx={x(point.t)} cy={ySpeed(point.speed)} r={4} className="fill-text-muted stroke-bg-base" strokeWidth={2} />
              </g>
            ) : null}
          </svg>

          {point ? (
            <div
              role="status"
              data-chart-tooltip
              className="pointer-events-none absolute top-3 z-10 grid w-52 gap-0.5 rounded-md border border-border bg-bg-base p-3 text-caption shadow-md"
              style={{ left: tooltipLeft }}
            >
              <strong className="tabular-nums text-text-main">
                #{point.seq} · {clockMs(point.t)}
              </strong>
              <span className="tabular-nums">
                가속 {point.accel}% · {point.accelMm.toFixed(2)}mm
              </span>
              <span className="tabular-nums">
                제동 {point.brake}% · {point.brakeMm.toFixed(2)}mm
              </span>
              <span className="tabular-nums">차속 {point.speed.toFixed(1)}km/h</span>
              <span className="tabular-nums text-text-muted">
                GPS {point.lat.toFixed(7)}, {point.lon.toFixed(7)}
              </span>
              {point.dual ? <span className="font-semibold">양발 동시 조작</span> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
