"use client";

import { AlertTriangle, CheckCircle2, Search, Wrench } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { DeviceConnectionStatus, FleetVehicleSummary } from "@/types/fleet-monitoring";

import { STATUS_LABELS, TRIGGER_LABELS } from "./fleet-labels";

const FILTERS: Array<DeviceConnectionStatus | "ALL"> = ["ALL", "NORMAL", "WARNING", "UNCALIBRATED"];
const time = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });

function StatusBadge({ status }: { status: DeviceConnectionStatus }) {
  const style =
    status === "NORMAL"
      ? { icon: CheckCircle2, cls: "border-good bg-good-bg text-good" }
      : status === "WARNING"
        ? { icon: AlertTriangle, cls: "border-dual-warning bg-dual-warning/15 text-text-main" }
        : { icon: Wrench, cls: "border-border-strong bg-bg-panel text-text-main" };
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-semibold whitespace-nowrap ${style.cls}`} data-status={status}>
      <Icon aria-hidden="true" size={14} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function FleetVehicleTable({ vehicles, periodDays }: { vehicles: readonly FleetVehicleSummary[]; periodDays: number }) {
  const [filter, setFilter] = useState<DeviceConnectionStatus | "ALL">("ALL");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: vehicles.length, NORMAL: 0, WARNING: 0, UNCALIBRATED: 0 };
    for (const v of vehicles) c[v.connectionStatus] = (c[v.connectionStatus] ?? 0) + 1;
    return c;
  }, [vehicles]);

  const q = query.trim().toLowerCase();
  const rows = vehicles.filter(
    (v) =>
      (filter === "ALL" || v.connectionStatus === filter) &&
      (!q || v.plateNumber.toLowerCase().includes(q) || v.modelName.toLowerCase().includes(q)),
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="단말 상태 필터">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`btn ${filter === f ? "" : "btn-secondary"}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "ALL" ? "전체" : STATUS_LABELS[f]} {counts[f] ?? 0}
            </button>
          ))}
        </div>
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">차량번호·차종 검색</span>
          <Search aria-hidden="true" size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" />
          <input type="search" className="input pl-9" placeholder="차량번호·차종 검색" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
        </label>
      </div>

      <p className="m-0 text-caption text-text-muted" aria-live="polite">
        {rows.length}대 표시
      </p>

      <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="소속 차량 관제 표" tabIndex={0}>
        <table className="w-full min-w-[820px] border-collapse text-left text-caption" data-fleet-vehicles>
          <thead className="bg-bg-panel">
            <tr>
              {["차량번호", "차종", "배정 운전자", "단말", "최근 동기화", "상태", `이벤트(${periodDays}일)`, "최근 이벤트"].map((h) => (
                <th key={h} scope="col" className="border-b border-border px-3 py-2 font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-text-muted">
                  조건에 맞는 차량이 없습니다. 필터나 검색어를 바꿔 보세요.
                </td>
              </tr>
            ) : (
              rows.map((v) => (
                <tr key={v.vehicleId} className="border-b border-border last:border-0" data-fleet-row={v.plateNumber}>
                  <td className="px-3 py-1">
                    <Link href={`/vehicles/${v.vehicleId}`} className="inline-flex min-h-(--size-touch) items-center font-bold text-text-main">
                      {v.plateNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-1">
                    {v.modelName}
                    {v.modelYear ? ` (${v.modelYear})` : ""}
                  </td>
                  <td className="px-3 py-1">{v.assignedDriverName ?? <span className="text-text-muted">미배정</span>}</td>
                  <td className="px-3 py-1 font-mono">{v.deviceSerialNumber ?? <span className="font-sans text-text-muted">없음</span>}</td>
                  <td className="px-3 py-1 tabular-nums whitespace-nowrap">{v.lastSyncedAt ? time.format(Date.parse(v.lastSyncedAt)) : <span className="text-text-muted">기록 없음</span>}</td>
                  <td className="px-3 py-1">
                    <StatusBadge status={v.connectionStatus} />
                  </td>
                  <td className="px-3 py-1 font-semibold tabular-nums">{v.recentEventCount}건</td>
                  <td className="px-3 py-1">
                    {v.lastEventId && v.lastTriggerType && v.lastEventAt ? (
                      <Link href={`/events/${v.lastEventId}`} className="inline-flex min-h-(--size-touch) items-center gap-1 whitespace-nowrap text-text-main underline">
                        {TRIGGER_LABELS[v.lastTriggerType]} · {time.format(Date.parse(v.lastEventAt))}
                      </Link>
                    ) : (
                      <span className="text-text-muted">없음</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
