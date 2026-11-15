import { Car, CheckCircle2, Cpu, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { Section } from "@/components/page/section";
import { PedalLiveDashboard } from "@/components/telemetry/pedal-live-dashboard";
import { isFactoryCalibration, listCalibrationTargets } from "@/lib/calibration/operations";
import { requireUserForPath } from "@/lib/auth/get-current-user";
import { allowedRolesForPath } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "대시보드 | 페달아이" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ calibrated?: string }>;
}) {
  const user = await requireUserForPath("/dashboard");
  const { calibrated } = await searchParams;
  const canManageVehicles = allowedRolesForPath("/vehicles")?.includes(user.role) ?? false;

  const supabase = await createClient();
  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, plate_number, model_name, model_year")
    .order("plate_number");
  if (error) throw new Error(`차량 목록 조회 실패 (${error.code})`);

  // 실시간 모니터링은 본인 단말이 있는 운전자에게 보여 준다
  const liveDevice =
    user.role === "driver" ? (await listCalibrationTargets(supabase, user)).find((d) => !isFactoryCalibration(d)) : undefined;

  return (
    <>
      <PageHeader
        title="대시보드"
        description="조회 권한이 있는 차량과 최근 페달 기록 현황을 확인합니다."
        action={
          canManageVehicles ? (
            <Link href="/vehicles" className="btn">
              <Plus aria-hidden="true" size={18} />
              차량 등록하기
            </Link>
          ) : null
        }
      />

      {calibrated === "1" ? (
        <p role="status" className="m-0 flex items-center gap-2 rounded-md border border-border-strong bg-accel-bg px-4 py-3 font-semibold">
          <CheckCircle2 aria-hidden="true" size={20} className="text-accel" />
          페달 영점 및 가동 범위 보정이 정상 저장되었습니다.
        </p>
      ) : null}

      {user.role === "driver" ? (
        liveDevice ? (
          <PedalLiveDashboard
            plateNumber={liveDevice.plateNumber}
            calibration={{
              accelCalibMin: liveDevice.accelCalibMin,
              accelCalibMax: liveDevice.accelCalibMax,
              brakeCalibMin: liveDevice.brakeCalibMin,
              brakeCalibMax: liveDevice.brakeCalibMax,
            }}
          />
        ) : (
          <Section id="live-empty-heading" title="실시간 페달 모니터링">
            <EmptyState icon={Cpu} title="연결된 페달아이 단말기가 없습니다.">
              <p className="m-0">먼저 기기 등록 및 페달 캘리브레이션을 진행해주세요.</p>
              <Link href="/devices/calibrate" className="btn mt-4">
                페달 캘리브레이션 시작하기
              </Link>
            </EmptyState>
          </Section>
        )
      ) : null}

      <Section id="vehicles-heading" title="조회 가능한 차량">
        {vehicles.length === 0 ? (
          <EmptyState icon={Car} title="등록된 주행 차량 및 최근 이벤트가 없습니다.">
            먼저 차량을 등록하거나 기기를 연동해 주세요.
          </EmptyState>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id}>
                <Link
                  href={`/vehicles/${vehicle.id}`}
                  className="flex min-h-(--size-touch) flex-wrap items-center gap-x-2 rounded-md border border-border bg-bg-base px-4 py-3 text-text-main no-underline hover:border-border-strong"
                >
                  <strong>{vehicle.plate_number}</strong>
                  <span className="text-text-muted">
                    {vehicle.model_name}
                    {vehicle.model_year ? ` (${vehicle.model_year}년식)` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
