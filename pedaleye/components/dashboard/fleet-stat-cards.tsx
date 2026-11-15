import { AlertTriangle, Car, Gauge, Wifi } from "lucide-react";

import type { FleetDashboardOverview } from "@/types/fleet-monitoring";

export function FleetStatCards({ overview }: { overview: FleetDashboardOverview }) {
  const cards = [
    { icon: Car, label: "관리 차량", value: `${overview.totalVehicles}대`, note: overview.organizationName },
    {
      icon: Wifi,
      label: "정상 연결 단말",
      value: `${overview.connectedDevices}대`,
      note: `24시간 내 동기화 · 주의 ${overview.warningDevices}대`,
    },
    {
      icon: AlertTriangle,
      label: `이상 운전 감지(최근 ${overview.periodDays}일)`,
      value: `${overview.totalEventsInPeriod}건`,
      note: overview.tamperedEventsInPeriod ? `무결성 실패 ${overview.tamperedEventsInPeriod}건 포함` : "사고 세션 기준",
    },
    { icon: Gauge, label: "미교정 단말", value: `${overview.uncalibratedDevices}대`, note: "단말 없음 또는 공장 기본값" },
  ];
  return (
    <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-fleet-kpis>
      {cards.map(({ icon: Icon, label, value, note }) => (
        <div key={label} className="card grid gap-1 p-4">
          <dt className="flex items-center gap-2 text-caption font-medium text-text-muted">
            <Icon aria-hidden="true" size={16} />
            {label}
          </dt>
          <dd className="m-0 text-metric font-bold tabular-nums">{value}</dd>
          <dd className="m-0 text-caption text-text-muted">{note}</dd>
        </div>
      ))}
    </dl>
  );
}
