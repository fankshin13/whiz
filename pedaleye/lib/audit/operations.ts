import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { CurrentUser } from "@/lib/auth/get-current-user";
import type { Database, Json } from "@/lib/supabase/database.types";

import { AUDIT_ACTIONS, AUDIT_TARGETS, type AuditActionType } from "./labels";

type Client = SupabaseClient<Database>;
type Operator = Pick<CurrentUser, "role" | "orgId">;
export type AuditLogRow = Database["public"]["Tables"]["audit_logs"]["Row"];

const TIMEZONE_OFFSET = "+09:00"; // 화면의 날짜는 한국 시간 기준
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const auditFilterSchema = z.object({
  from: z.string().regex(DATE).optional().catch(undefined),
  to: z.string().regex(DATE).optional().catch(undefined),
  action: z.enum(AUDIT_ACTIONS as [AuditActionType, ...AuditActionType[]]).optional().catch(undefined),
  target: z.enum(AUDIT_TARGETS.map((t) => t.key) as [string, ...string[]]).optional().catch(undefined),
  status: z.enum(["SUCCESS", "DENIED"]).optional().catch(undefined),
  org: z.guid().optional().catch(undefined),
  q: z.string().trim().max(50).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});
export type AuditFilter = z.infer<typeof auditFilterSchema>;

export const AUDIT_PAGE_SIZE = 20;
export const AUDIT_EXPORT_LIMIT = 5_000;

function canReadAudit(user: Operator): boolean {
  return user.role === "super_admin" || (user.role === "org_admin" && user.orgId !== null);
}

/** 한국 날짜(YYYY-MM-DD) 기본값: 최근 7일 */
export function defaultRange(now = new Date()): { from: string; to: string } {
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
  return { from: fmt(new Date(now.getTime() - 6 * 86_400_000)), to: fmt(now) };
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** PostgREST or() 문법을 깨뜨릴 수 있는 문자를 지운다 */
function safeSearch(term: string): string {
  return term.replace(/[,()*%\\:"']/g, " ").trim();
}

/**
 * 감사 로그 조회. 조직 관리자는 요청과 무관하게 자기 조직으로 고정(RLS 가 한 번 더 막음).
 * limit 를 주면 그만큼(CSV), 아니면 page 단위로 가져온다.
 */
export async function listAuditLogs(
  supabase: Client,
  user: Operator,
  filter: AuditFilter,
  options: { limit?: number } = {},
): Promise<{ rows: AuditLogRow[]; total: number; page: number; totalPages: number }> {
  if (!canReadAudit(user)) throw new Error("FORBIDDEN");
  const range = defaultRange();
  const from = filter.from ?? range.from;
  const to = filter.to ?? range.to;

  let query = supabase
    .from("audit_logs")
    .select("*", { count: "exact" })
    .gte("created_at", `${from}T00:00:00${TIMEZONE_OFFSET}`)
    .lt("created_at", `${nextDay(to)}T00:00:00${TIMEZONE_OFFSET}`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  const orgId = user.role === "org_admin" ? user.orgId : filter.org;
  if (orgId) query = query.eq("org_id", orgId);
  if (filter.action) query = query.eq("action_type", filter.action);
  if (filter.target) query = query.eq("target_type", filter.target);
  if (filter.status) query = query.eq("status", filter.status);
  const term = filter.q ? safeSearch(filter.q) : "";
  if (term) query = query.or(`actor_name.ilike."*${term}*",target_display_name.ilike."*${term}*"`);

  const page = filter.page;
  query = options.limit
    ? query.limit(options.limit)
    : query.range((page - 1) * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(`감사 로그 조회 실패 (${error.code})`);
  const total = count ?? data.length;
  return { rows: data, total, page, totalPages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) };
}

/**
 * 서버가 남기는 감사 기록(보고서 열람·출력, 권한 거부). 수행자는 DB 가 로그인 세션으로 정한다.
 * 기록 실패가 사용자 작업을 막지는 않는다(로그만 남김).
 */
export async function logAuditEvent(
  supabase: Client,
  event: {
    action: AuditActionType;
    targetType: string;
    targetId: string;
    targetName?: string;
    summary?: Record<string, Json>;
    status?: "SUCCESS" | "DENIED";
  },
): Promise<void> {
  const { error } = await supabase.rpc("log_admin_audit_event", {
    p_action_type: event.action,
    p_target_type: event.targetType,
    p_target_id: event.targetId.slice(0, 100) || "-",
    p_target_display_name: event.targetName ?? undefined,
    p_changes_summary: event.summary ?? {},
    p_status: event.status ?? "SUCCESS",
  });
  if (error) console.error("audit log write failed", { code: error.code, action: event.action });
}

/** 작업 결과가 권한 부족으로 거부됐는지(서버 operations 의 안내 문구 기준) */
export function isPermissionDenied(message: string | null | undefined): boolean {
  return !!message && /권한/.test(message);
}

// ── CSV ─────────────────────────────────────────────────────────────

/** 엑셀이 수식으로 실행하지 않도록 =,+,-,@ 로 시작하는 값 앞에 ' 를 붙이고, 따옴표로 감싼다. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function auditCsv(rows: AuditLogRow[], labels: { action: (a: AuditActionType) => string; role: (r: string | null) => string; time: (iso: string) => string }): string {
  const header = ["발생 시각", "수행자", "역할", "작업", "대상 종류", "대상", "대상 ID", "결과", "요청 IP", "조직 ID", "변경 요약"];
  const lines = rows.map((row) =>
    [
      labels.time(row.created_at),
      row.actor_name,
      labels.role(row.actor_role),
      labels.action(row.action_type),
      row.target_type,
      row.target_display_name,
      row.target_id,
      row.status === "SUCCESS" ? "성공" : "거부",
      row.ip_address,
      row.org_id ?? "",
      row.changes_summary,
    ]
      .map(csvCell)
      .join(","),
  );
  // UTF-8 BOM: 엑셀에서 한글이 깨지지 않게
  return `﻿${[header.map(csvCell).join(","), ...lines].join("\r\n")}\r\n`;
}

/** 작업이 권한 부족으로 거부됐으면 DENIED 로 기록한다(서버 액션에서 호출). */
export async function auditIfDenied(
  supabase: Client,
  error: string | null | undefined,
  event: { action: AuditActionType; targetType: string; targetId?: string | null; targetName?: string },
): Promise<void> {
  if (!isPermissionDenied(error)) return;
  await logAuditEvent(supabase, {
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId || "-",
    targetName: event.targetName,
    summary: { reason: error ?? "" },
    status: "DENIED",
  });
}
