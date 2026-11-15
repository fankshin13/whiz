import { Gauge, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { PendingAction } from "@/components/page/pending-action";
import { Section } from "@/components/page/section";
import { requireUserForPath } from "@/lib/auth/get-current-user";

export const metadata: Metadata = { title: "차량 상세 | 페달아이" };

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUserForPath(`/vehicles/${id}`);

  return (
    <>
      <PageHeader
        title="차량 상세"
        description="차량 정보와 장착 단말의 가속·제동 페달 보정 상태를 확인합니다."
        action={
          <PendingAction id="start-calibration">
            <SlidersHorizontal aria-hidden="true" size={18} />
            단말기 캘리브레이션 시작
          </PendingAction>
        }
      />
      <Section id="vehicle-detail-heading" title="단말 보정 상태">
        <EmptyState icon={Gauge} title="차량 상세 화면을 준비 중입니다.">
          가속·제동 페달의 영점(0%)과 최대 답입(100%) 기준값, 펌웨어 버전, 마지막 동기화 시각이 표시됩니다.
        </EmptyState>
      </Section>
    </>
  );
}
