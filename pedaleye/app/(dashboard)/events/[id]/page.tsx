import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";

import { toChartPoints } from "@/components/forensics/chart-point";
import { ForensicChart } from "@/components/forensics/forensic-chart";
import { IntegrityBadge, TamperDetail, formatSeoulTime, shortHash } from "@/components/forensics/integrity-badge";
import { PacketGrid } from "@/components/forensics/packet-grid";
import { ReportLink } from "@/components/forensics/report-link";
import { ReverifyButton } from "@/components/forensics/reverify-button";
import { PageHeader } from "@/components/page/page-header";
import { Section } from "@/components/page/section";
import { requireUserForPath } from "@/lib/auth/get-current-user";
import { loadSessionForensics } from "@/lib/forensics/session-forensics";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "사고 세션 상세 | 페달아이" };

const TRIGGER_LABELS = { shock: "충격 감지", sudden_accel: "급가감속 감지", manual: "수동 백업", periodic: "정기 기록" } as const;

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUserForPath(`/events/${id}`);
  const result = await loadSessionForensics(await createClient(), user, id);

  if (!result.success && (result.status === 403 || result.status === 404)) forbidden();

  if (!result.success) {
    return (
      <>
        <PageHeader title="사고 세션 상세" description="사고 전후 페달 궤적과 해시 체인 무결성 검증 결과를 확인합니다." />
        <div role="alert" className="alert grid gap-3">
          <p className="m-0">{result.error}</p>
          <Link href="/events" className="btn btn-secondary justify-self-start">
            <ArrowLeft aria-hidden="true" size={18} />
            사고 이벤트 목록으로
          </Link>
        </div>
      </>
    );
  }

  const { data } = result;
  const { verification } = data;
  const points = toChartPoints(data.packets);

  return (
    <>
      <PageHeader
        title="사고 세션 상세"
        description={`${data.plateNumber} · 단말 ${data.deviceSerialNumber} · ${TRIGGER_LABELS[data.triggerType]}`}
        action={
          <div className="flex flex-wrap items-start gap-2">
            <ReverifyButton sessionId={data.sessionId} />
            <ReportLink sessionId={data.sessionId} tampered={!verification.isValid} />
          </div>
        }
      />

      <section aria-label="무결성 요약" className="card grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <IntegrityBadge verification={verification} />
          <span className="text-caption text-text-muted">전수 검증 {verification.verificationDurationMs}ms · SHA-256(FIPS 180-4)</span>
        </div>
        <dl className="m-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-0.5">
            <dt className="text-caption text-text-muted">패킷 수</dt>
            <dd className="m-0 text-h2 font-bold tabular-nums">{verification.totalRecords.toLocaleString("ko-KR")}개</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-caption text-text-muted">기록 구간(서울)</dt>
            <dd className="m-0 font-semibold tabular-nums">
              {formatSeoulTime(Date.parse(data.startTime))}
              <br />~ {formatSeoulTime(Date.parse(data.endTime))}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-caption text-text-muted">최초 체인 해시</dt>
            <dd className="m-0 font-mono" title={verification.initialHash}>
              {shortHash(verification.initialHash)}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-caption text-text-muted">최종 체인 해시</dt>
            <dd className="m-0 font-mono" title={verification.finalHash}>
              {shortHash(verification.finalHash) || "계산 불가"}
            </dd>
          </div>
        </dl>
        <TamperDetail verification={verification} />
      </section>

      <Section id="chart-heading" title="페달 조작 시계열">
        <ForensicChart points={points} />
      </Section>

      <Section id="grid-heading" title="패킷 데이터">
        <PacketGrid points={points} highlightSeq={verification.failureDetail?.failedSequenceId} />
      </Section>
    </>
  );
}
