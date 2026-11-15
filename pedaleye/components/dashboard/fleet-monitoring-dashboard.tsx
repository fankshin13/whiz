import { Car, Plus } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/page/empty-state";
import { Section } from "@/components/page/section";
import { PERIOD_OPTIONS } from "@/lib/fleet/overview";
import { getFleetMonitoringOverview } from "@/lib/fleet/monitoring";

import { FleetEventChart } from "./fleet-event-chart";
import { FleetRetry } from "./fleet-retry";
import { FleetStatCards } from "./fleet-stat-cards";
import { FleetVehicleTable } from "./fleet-vehicle-table";

/** 관리자 관제 화면(서버 컴포넌트). Suspense 안에서 읽어 로딩 중 스켈레톤을 보인다. */
export async function FleetMonitoringDashboard({ periodDays }: { periodDays: number }) {
  const result = await getFleetMonitoringOverview(periodDays);
  if (!result.success) return <FleetRetry />;
  const overview = result.data;

  if (overview.totalVehicles === 0) {
    return (
      <Section id="fleet-empty-heading" title="통합 관제">
        <EmptyState icon={Car} title="등록된 관제 차량이 없습니다.">
          <Link href="/vehicles" className="btn mt-2">
            <Plus aria-hidden="true" size={18} />
            신규 차량 등록하기
          </Link>
        </EmptyState>
      </Section>
    );
  }

  return (
    <div className="grid gap-6" data-fleet-dashboard>
      <nav aria-label="집계 기간" className="flex flex-wrap gap-2">
        {PERIOD_OPTIONS.map((days) => (
          <Link
            key={days}
            href={`/dashboard?days=${days}`}
            aria-current={days === periodDays ? "page" : undefined}
            className={`btn ${days === periodDays ? "" : "btn-secondary"}`}
          >
            {days === 7 ? "주간(7일)" : "월간(30일)"}
          </Link>
        ))}
      </nav>
      <FleetStatCards overview={overview} />
      <Section id="fleet-chart-heading" title={`일자별 이상 운전 이벤트 (최근 ${periodDays}일)`}>
        <FleetEventChart stats={overview.dailyStats} />
      </Section>
      <Section id="fleet-table-heading" title="소속 차량 관제">
        <FleetVehicleTable vehicles={overview.vehicles} periodDays={periodDays} />
      </Section>
    </div>
  );
}
