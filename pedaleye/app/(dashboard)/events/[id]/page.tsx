import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";

import { toChartPoints } from "@/components/forensics/chart-point";
import { ForensicChart } from "@/components/forensics/forensic-chart";
import { IntegrityBadge, TamperDetail, formatSeoulTime, shortHash } from "@/components/forensics/integrity-badge";
import { LegalHoldDialog } from "@/components/forensics/legal-hold-dialog";
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
  const { data: hold } = await (await createClient())
    .from("event_sessions")
    .select("legal_hold, legal_hold_reason, legal_hold_at, created_at")
    .eq("id", data.sessionId)
    .maybeSingle();
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
          {data.deviceSealed === "verified" ? (
            <span className="rounded-md border border-good bg-good-bg px-2 text-caption font-semibold text-good">단말 봉인 서명 확인</span>
          ) : data.deviceSealed === "invalid" ? (
            <span className="rounded-md border border-critical bg-critical-bg px-2 text-caption font-semibold text-critical">단말 봉인 서명 불일치</span>
          ) : (
            <span className="rounded-md border border-border-strong px-2 text-caption font-medium text-text-muted">단말 봉인 없음(앱 생성 기록)</span>
          )}
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

      {hold ? (
        <Section id="retention-heading" title="보관">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0">
              {hold.legal_hold ? (
                <>
                  <strong>법적 보존 중</strong> · {hold.legal_hold_reason} ({formatSeoulTime(Date.parse(hold.legal_hold_at ?? hold.created_at)).slice(0, 16)} 표시). 보관 기간이 지나도 파기하지 않습니다.
                </>
              ) : (
                <>생성 후 3년이 지나면 자동 파기됩니다(파기 예정 {formatSeoulTime(Date.parse(hold.created_at) + 3 * 365.25 * 86_400_000).slice(0, 10)}).</>
              )}
            </p>
            {user.role === "super_admin" ? <LegalHoldDialog sessionId={data.sessionId} held={hold.legal_hold} /> : null}
          </div>
        </Section>
      ) : null}
    </>
  );
}
