import { CheckCircle2, ChevronLeft, ChevronRight, Download, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuditDetailDialog, CsvExportButton } from "@/components/audit/audit-client";
import { RunRetentionDialog } from "@/components/audit/retention-dialog";
import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { RetryAlert } from "@/components/page/retry-alert";
import { Section } from "@/components/page/section";
import { AUDIT_ACTION_LABELS, AUDIT_STATUS_LABELS, AUDIT_TARGETS, ROLE_LABELS } from "@/lib/audit/labels";
import { auditFilterSchema, defaultRange, listAuditLogs, type AuditFilter, type AuditLogRow } from "@/lib/audit/operations";
import { AUDIT_RETENTION_DAYS, countExpiredAuditLogs, retentionCutoff } from "@/lib/audit/retention";
import { requireUserForPath, type CurrentUser } from "@/lib/auth/get-current-user";
import { getCronSecret } from "@/lib/server/env";
import { createAdminClient } from "@/lib/server/supabase-admin";
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
            ? "모든 조직의 관리 작업·보고서 열람 기록입니다. 기록은 누구도 수정할 수 없으며, 1년이 지나면 아카이브를 남긴 뒤 정리됩니다."
            : "우리 조직의 관리 작업·보고서 열람 기록입니다. 기록은 누구도 수정할 수 없으며, 1년이 지나면 아카이브를 남긴 뒤 정리됩니다."
        }
        action={<CsvExportButton query={toQuery(filter)} />}
      />
      <RetentionNotice notice={first(raw.notice)} count={first(raw.count)} />
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
      {user.role === "super_admin" ? (
        <Section id="audit-retention-heading" title="보존 관리">
          <Suspense fallback={<AuditSkeleton />}>
            <RetentionPanel />
          </Suspense>
        </Section>
      ) : null}
    </>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const dateFormat = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Seoul" });

/** 수동 정리 결과 안내(서버 액션이 주소로 넘긴다) */
function RetentionNotice({ notice, count }: { notice?: string; count?: string }) {
  let body: string | null = null;
  if (notice === "retention_nothing") body = "보존 기간이 지난 기록이 없어 정리할 것이 없습니다.";
  if (notice === "retention_purged") {
    const n = Number.parseInt(count ?? "", 10);
    body = `보존 기간이 지난 기록${Number.isFinite(n) ? ` ${n.toLocaleString("ko-KR")}건` : ""}을 아카이브한 뒤 삭제했습니다. 아카이브 파일은 아래 보존 관리에서 내려받을 수 있습니다.`;
  }
  if (!body) return null;
  return (
    <div role="status" className="flex items-start gap-2 rounded-md border border-border-strong bg-good-bg px-4 py-3 font-semibold text-good">
      <CheckCircle2 aria-hidden="true" size={20} className="mt-0.5 shrink-0" />
      <p className="m-0">{body}</p>
    </div>
  );
}

/** 보존 기간·자동 정리 상태·아카이브 목록(슈퍼 관리자) */
async function RetentionPanel() {
  const cutoff = retentionCutoff();
  const cutoffLabel = dateFormat.format(cutoff);
  let expired: number;
  let archives: { id: string; created_at: string; cutoff: string; row_count: number; purged_count: number | null; purged_at: string | null; created_by: string | null }[];
  try {
    expired = await countExpiredAuditLogs(createAdminClient());
    const { data, error } = await (await createClient())
      .from("audit_log_archives")
      .select("id, created_at, cutoff, row_count, purged_count, purged_at, created_by")
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) throw new Error(error.code);
    archives = data;
  } catch (error) {
    console.error("audit retention panel failed", { message: error instanceof Error ? error.message : "unknown" });
    return <RetryAlert message="보존 관리 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." />;
  }
  const autoOn = getCronSecret() !== null;

  return (
    <div className="grid gap-4">
      <dl className="m-0 grid gap-2 sm:grid-cols-3">
        <div className="grid gap-1 rounded-md border border-border p-3">
          <dt className="text-caption text-text-muted">보존 기간</dt>
          <dd className="m-0 font-semibold">{AUDIT_RETENTION_DAYS}일(1년)</dd>
        </div>
        <div className="grid gap-1 rounded-md border border-border p-3">
          <dt className="text-caption text-text-muted">자동 정리</dt>
          <dd className="m-0 font-semibold">{autoOn ? "매월 2일 03:10 실행" : "꺼짐(CRON_SECRET 미설정)"}</dd>
        </div>
        <div className="grid gap-1 rounded-md border border-border p-3">
          <dt className="text-caption text-text-muted">{cutoffLabel} 이전(보존 기간 경과)</dt>
          <dd className="m-0 font-semibold tabular-nums">{expired.toLocaleString("ko-KR")}건</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        <RunRetentionDialog expiredCount={expired} cutoffLabel={cutoffLabel} />
      </div>
      {archives.length === 0 ? (
        <p className="m-0 text-text-muted">아직 만든 아카이브가 없습니다.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="감사 로그 아카이브">
          {archives.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-bg-base p-3">
              <div className="grid min-w-0 gap-1">
                <strong>
                  {dateFormat.format(new Date(a.cutoff))} 이전 기록 {a.row_count.toLocaleString("ko-KR")}건
                </strong>
                <span className="text-caption text-text-muted">
                  {formatTime(a.created_at)} · {a.created_by ? "수동" : "자동"} ·{" "}
                  {a.purged_at ? `삭제 완료 ${(a.purged_count ?? 0).toLocaleString("ko-KR")}건` : "삭제 중단(기록 불일치 등, 기록은 보존됨)"}
                </span>
              </div>
              <a href={`/admin/audit/archives/${a.id}`} className="btn btn-secondary">
                <Download aria-hidden="true" size={18} />
                내려받기
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
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
