import { Cpu } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { CalibrationWizard } from "@/components/calibration/calibration-wizard";
import { CurrentCalibration } from "@/components/calibration/current-calibration";
import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { Section } from "@/components/page/section";
import { requireUserForPath } from "@/lib/auth/get-current-user";
import { listCalibrationTargets } from "@/lib/calibration/operations";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "페달 캘리브레이션 | 페달아이" };

export default async function CalibratePage({
  searchParams,
}: {
  searchParams: Promise<{ deviceId?: string | string[] }>;
}) {
  const user = await requireUserForPath("/devices/calibrate");
  const { deviceId } = await searchParams;
  const targets = await listCalibrationTargets(await createClient(), user);
  const selected =
    typeof deviceId === "string"
      ? targets.find((target) => target.deviceId === deviceId)
      : targets.length === 1
        ? targets[0]
        : undefined;
  const isAdmin = user.role !== "driver";

  return (
    <>
      <PageHeader
        title="페달 캘리브레이션"
        description={
          selected
            ? `${selected.plateNumber} · 단말 ${selected.serialNumber}의 가속·제동 페달 영점과 최대 답입 지점을 보정합니다.`
            : "ToF 센서 거리값을 차량 페달 가동 범위에 맞춰 보정합니다."
        }
      />

      {targets.length === 0 ? (
        <Section id="no-device-heading" title="보정할 단말">
          <EmptyState icon={Cpu} title="연결된 페달아이 단말이 없습니다.">
            <p className="m-0">차량 배정 및 기기 등록을 먼저 진행해 주세요.</p>
            <Link href={isAdmin ? "/vehicles" : "/dashboard"} className="btn mt-4">
              {isAdmin ? "차량 관리로 이동" : "대시보드로 이동"}
            </Link>
          </EmptyState>
        </Section>
      ) : selected ? (
        <>
          <Section id="current-calibration-heading" title="현재 저장된 보정값">
            <CurrentCalibration device={selected} />
          </Section>
          <CalibrationWizard key={selected.deviceId} device={selected} />
        </>
      ) : (
        <Section id="select-device-heading" title="보정할 단말 선택">
          <ul className="m-0 grid list-none gap-2 p-0">
            {targets.map((target) => (
              <li key={target.deviceId}>
                <Link
                  href={`/devices/calibrate?deviceId=${target.deviceId}`}
                  className="flex min-h-(--size-touch) flex-wrap items-center gap-x-2 rounded-md border border-border bg-bg-base px-4 py-3 text-text-main no-underline hover:border-border-strong"
                >
                  <strong>{target.plateNumber}</strong>
                  <span className="text-text-muted">단말 {target.serialNumber}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
