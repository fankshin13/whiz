import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuditDetailDialog, CsvExportButton } from "@/components/audit/audit-client";
import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { RetryAlert } from "@/components/page/retry-alert";
import { Section } from "@/components/page/section";
import { AUDIT_ACTION_LABELS, AUDIT_STATUS_LABELS, AUDIT_TARGETS, ROLE_LABELS } from "@/lib/audit/labels";
import { auditFilterSchema, defaultRange, listAuditLogs, type AuditFilter, type AuditLogRow } from "@/lib/audit/operations";
import { requireUserForPath, type CurrentUser } from "@/lib/auth/get-current-user";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "감사 로그 | 페달아이" };

const timeFormat = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE ?? "Asia/Seoul",
});
const formatTime = (iso: string) => timeFormat.format(new Date(iso)); // YYYY-MM-DD HH:mm:ss

type RawParams = Record<string, string | string[] | undefined>;

function toQuery(filter: AuditFilter, page?: number): string {
  const params = new URLSearchParams();
  for (const key of ["from", "to", "target", "action", "status", "org", "q"] as const) {
    const value = filter[key];
    if (value) params.set(key, value);
  }
  if (page && page > 1) params.set("page", String(page));
  return params.toString();
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  // 슈퍼 관리자·조직 관리자 전용(라우트 맵). 운전자·조사관은 403
  const user = await requireUserForPath("/admin/audit");
  const raw = await searchParams;
  const filter = auditFilterSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const range = defaultRange();
  const supabase = await createClient();
  const orgs =
    user.role === "super_admin" ? ((await supabase.from("organizations").select("id, name").order("name")).data ?? []) : [];

  return (
    <>
      <PageHeader
        title="감사 로그"
        description={
          user.role === "super_admin"
            ? "모든 조직의 관리 작업·보고서 열람 기록입니다. 기록은 추가만 되며 누구도 수정하거나 삭제할 수 없습니다."
            : "우리 조직의 관리 작업·보고서 열람 기록입니다. 기록은 추가만 되며 누구도 수정하거나 삭제할 수 없습니다."
        }
        action={<CsvExportButton query={toQuery(filter)} />}
      />
      <Section id="audit-filter-heading" title="조회 조건">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="감사 로그 조회 조건">
          <Field label="시작일" htmlFor="audit-from">
            <input id="audit-from" name="from" type="date" className="input" defaultValue={filter.from ?? range.from} />
          </Field>
          <Field label="종료일" htmlFor="audit-to">
            <input id="audit-to" name="to" type="date" className="input" defaultValue={filter.to ?? range.to} />
          </Field>
          <Field label="작업 분류" htmlFor="audit-target">
            <select id="audit-target" name="target" className="input" defaultValue={filter.target ?? ""}>
              <option value="">전체</option>
              {AUDIT_TARGETS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="결과" htmlFor="audit-status">
            <select id="audit-status" name="status" className="input" defaultValue={filter.status ?? ""}>
              <option value="">전체</option>
              <option value="SUCCESS">성공</option>
              <option value="DENIED">거부</option>
            </select>
          </Field>
          {user.role === "super_admin" ? (
            <Field label="조직" htmlFor="audit-org">
              <select id="audit-org" name="org" className="input" defaultValue={filter.org ?? ""}>
                <option value="">전체 조직</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="수행자·대상 검색" htmlFor="audit-q">
            <input id="audit-q" name="q" className="input" maxLength={50} placeholder="이름, 차량 번호, 일련번호" defaultValue={filter.q ?? ""} />
          </Field>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-2">
            <button type="submit" className="btn">
              조회
            </button>
            <Link href="/admin/audit" className="btn btn-secondary">
              필터 초기화
            </Link>
          </div>
        </form>
      </Section>
      <Section id="audit-list-heading" title="감사 기록">
        <Suspense key={toQuery(filter, filter.page)} fallback={<AuditSkeleton />}>
          <AuditList user={user} filter={filter} />
        </Suspense>
      </Section>
    </>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={htmlFor} className="font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}

async function AuditList({ user, filter }: { user: CurrentUser; filter: AuditFilter }) {
  let result: Awaited<ReturnType<typeof listAuditLogs>>;
  try {
    result = await listAuditLogs(await createClient(), user, filter);
  } catch (error) {
    console.error("audit page load failed", { message: error instanceof Error ? error.message : "unknown" });
    return <RetryAlert message="감사 로그를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." />;
  }
  const { rows, total, page, totalPages } = result;

  if (rows.length === 0) {
    return (
      <EmptyState icon={ScrollText} title="선택한 조건에 부합하는 관리 작업 감사 로그가 없습니다.">
        <div className="mt-2 flex justify-center">
          <Link href="/admin/audit" className="btn btn-secondary">
            필터 초기화
          </Link>
        </div>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="m-0 text-text-muted">
        총 <strong className="tabular-nums text-text-main">{total.toLocaleString("ko-KR")}</strong>건
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {rows.map((row) => (
          <AuditRow key={row.id} row={row} />
        ))}
      </ul>
      <nav aria-label="페이지 이동" className="flex flex-wrap items-center justify-center gap-3">
        {page > 1 ? (
          <Link href={`/admin/audit?${toQuery(filter, page - 1)}`} className="btn btn-secondary" rel="prev">
            <ChevronLeft aria-hidden="true" size={18} />
            이전
          </Link>
        ) : null}
        <span className="tabular-nums text-text-muted">
          {page} / {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={`/admin/audit?${toQuery(filter, page + 1)}`} className="btn btn-secondary" rel="next">
            다음
            <ChevronRight aria-hidden="true" size={18} />
          </Link>
        ) : null}
      </nav>
    </div>
  );
}

function AuditRow({ row }: { row: AuditLogRow }) {
  const denied = row.status === "DENIED";
  const action = AUDIT_ACTION_LABELS[row.action_type];
  const role = row.actor_role ? ROLE_LABELS[row.actor_role] : "시스템";
  return (
    <li className="grid gap-2 rounded-md border border-border bg-bg-base p-3 md:grid-cols-[11rem_minmax(0,1fr)_auto] md:items-center md:gap-4">
      <time dateTime={row.created_at} className="font-mono text-caption tabular-nums text-text-muted">
        {formatTime(row.created_at)}
      </time>
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong>{action}</strong>
          <span
            className={
              denied
                ? "rounded-md border border-critical bg-critical-bg px-2 text-caption font-semibold text-critical"
                : "rounded-md border border-accel bg-accel-bg px-2 text-caption font-semibold text-accel"
            }
          >
            {AUDIT_STATUS_LABELS[row.status]}
          </span>
          <span className="min-w-0 break-all">{row.target_display_name}</span>
        </div>
        <p className="m-0 min-w-0 break-all text-caption text-text-muted">
          {row.actor_name} · {role} · IP {row.ip_address}
        </p>
      </div>
      <AuditDetailDialog
        id={row.id}
        title={`${action} 상세`}
        meta={[
          { label: "발생 시각", value: formatTime(row.created_at) },
          { label: "수행자", value: `${row.actor_name} (${role})` },
          { label: "대상", value: `${row.target_display_name} · ${row.target_type}` },
          { label: "대상 ID", value: row.target_id },
          { label: "결과", value: AUDIT_STATUS_LABELS[row.status] },
          { label: "요청 IP", value: row.ip_address },
        ]}
        summary={row.changes_summary as Json as never}
      />
    </li>
  );
}

function AuditSkeleton() {
  return (
    <div className="grid gap-2" role="status" aria-label="감사 로그를 불러오는 중">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="grid gap-2 rounded-md border border-border bg-bg-base p-3">
          <div className="h-4 w-1/3 rounded-md bg-border motion-safe:animate-pulse" />
          <div className="h-4 w-3/4 rounded-md bg-border motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}
