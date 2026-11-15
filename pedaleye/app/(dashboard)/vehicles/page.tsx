import { Car, Plus } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { PendingAction } from "@/components/page/pending-action";
import { Section } from "@/components/page/section";
import { requireUserForPath } from "@/lib/auth/get-current-user";

export const metadata: Metadata = { title: "차량 관리 | 페달아이" };

export default async function VehiclesPage() {
  await requireUserForPath("/vehicles");

  return (
    <>
      <PageHeader
        title="차량 관리"
        description="조직에 등록된 차량과 장착된 페달아이 단말을 관리합니다."
        action={
          <PendingAction id="new-vehicle">
            <Plus aria-hidden="true" size={18} />
            신규 차량 등록
          </PendingAction>
        }
      />
      <Section id="vehicle-list-heading" title="차량 및 단말 연동 현황">
        <EmptyState icon={Car} title="차량 목록 화면을 준비 중입니다.">
          차량 번호, 차종, 배정 운전자, 장착 단말 일련번호와 캘리브레이션 상태가 이 표에 표시됩니다.
        </EmptyState>
      </Section>
    </>
  );
}
