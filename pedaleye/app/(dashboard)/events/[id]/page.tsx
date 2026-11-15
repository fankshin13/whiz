import { FileText, LineChart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { Section } from "@/components/page/section";
import { requireUserForPath } from "@/lib/auth/get-current-user";

export const metadata: Metadata = { title: "이벤트 상세 | 페달아이" };

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUserForPath(`/events/${id}`);

  return (
    <>
      <PageHeader
        title="이벤트 상세"
        description="사고 전후 페달 궤적과 SHA-256 해시 체인 무결성 검증 결과를 확인합니다."
        action={
          <Link href={`/events/${id}/report`} className="btn">
            <FileText aria-hidden="true" size={18} />
            검증 보고서 인쇄/다운로드
          </Link>
        }
      />
      <Section id="trajectory-heading" title="페달 궤적 및 해시 체인">
        <EmptyState icon={LineChart} title="이벤트 상세 화면을 준비 중입니다.">
          가속(청색)·제동(적색) 답력 시계열 차트와 레코드별 해시 연속성 검증 결과가 표시됩니다.
        </EmptyState>
      </Section>
    </>
  );
}
