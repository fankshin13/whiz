import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/layout/brand";
import { requireUserForPath } from "@/lib/auth/get-current-user";

import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "무결성 검증 보고서 | 페달아이" };

const SECTIONS = [
  { title: "1. 사건 개요", body: "트리거 유형, 발생 시각(Asia/Seoul), 차량·단말 식별 정보" },
  { title: "2. 해시 체인 무결성 검증", body: "레코드 수, 시작·최종 해시, 시퀀스 연속성 및 위·변조 판정" },
  { title: "3. 페달 조작 궤적", body: "사고 전후 60초 가속·제동 답력 그래프" },
];

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUserForPath(`/events/${id}/report`);

  return (
    <div className="mx-auto grid w-full max-w-[210mm] gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/events/${id}`} className="btn btn-secondary">
          <ArrowLeft aria-hidden="true" size={18} />
          이벤트로 돌아가기
        </Link>
        <PrintButton />
      </div>

      <article className="grid gap-6 rounded-lg border border-border bg-bg-base p-6 sm:p-8 print:border-0 print:p-0">
        <header className="grid gap-2 border-b border-border pb-4">
          <Brand />
          <h1 className="m-0 text-h1 font-bold">페달 조작 무결성 검증 보고서</h1>
          <p className="m-0 text-text-muted">
            국립과학수사연구원·경찰·손해보험사 제출용. 보고서 생성 기능을 준비 중이며, 아래 항목이 채워집니다.
          </p>
        </header>
        {SECTIONS.map((section) => (
          <section key={section.title} className="grid gap-1">
            <h2 className="m-0 text-h2 font-semibold">{section.title}</h2>
            <p className="m-0 text-text-muted">{section.body}</p>
          </section>
        ))}
      </article>
    </div>
  );
}
