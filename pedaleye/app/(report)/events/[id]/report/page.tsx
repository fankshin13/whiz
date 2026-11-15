import { AlertCircle, ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ForensicReportTemplate } from "@/components/forensics/forensic-report-template";
import { ReportActionBar } from "@/components/forensics/report-action-bar";
import { requireUserForPath } from "@/lib/auth/get-current-user";
import { getForensicReportProjection } from "@/lib/forensics/report-projection";

export const metadata: Metadata = { title: "디지털 증거 무결성 검증 확인서 | 페달아이" };

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoPrint?: string }>;
}) {
  const { id } = await params;
  const { autoPrint } = await searchParams;
  await requireUserForPath(`/events/${id}/report`);
  const result = await getForensicReportProjection(id);

  if (!result.success) {
    return (
      <div className="mx-auto grid w-full max-w-[210mm] gap-4">
        <div role="alert" className="card grid gap-4" data-report-error={result.kind}>
          <AlertCircle aria-hidden="true" size={28} className="text-brake" />
          <h1 className="m-0 text-h1 font-bold">{result.kind === "empty" ? "출력할 기록이 없습니다" : "보고서를 열 수 없습니다"}</h1>
          <p className="m-0">{result.error}</p>
          {result.kind === "empty" ? (
            <p className="m-0 text-text-muted">단말을 앱과 다시 동기화한 뒤 사고 세션을 다시 올려 주세요.</p>
          ) : null}
          <Link href="/events" className="btn btn-secondary justify-self-start">
            <ArrowLeft aria-hidden="true" size={18} />
            목록으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <ReportActionBar sessionId={id} autoPrint={autoPrint === "true"} />
      <ForensicReportTemplate report={result.data} qrSvg={result.qrSvg} verifyUrl={result.verifyUrl} />
    </div>
  );
}
