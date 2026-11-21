import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { auditCsvKorean, type AuditLogRow } from "./operations";

/**
 * 감사 로그 보존(1년). service_role 클라이언트로만 실행한다(호출 전에 권한 확인은 호출한 쪽 책임).
 * 순서: 대상(기준 시각 이전) 행 → CSV → 비공개 저장소 업로드 → DB 가 건수·지문 확인 후 등록 → 지문 재확인 후 삭제.
 * 어느 단계에서 실패해도 삭제는 일어나지 않는다(등록 실패 시 올린 파일은 지운다).
 */
type Client = SupabaseClient<Database>;

export const AUDIT_RETENTION_DAYS = 365;
export const AUDIT_ARCHIVE_BUCKET = "audit-archives";
const PAGE = 1000;

export type RetentionResult =
  | { status: "nothing"; cutoff: string }
  | { status: "purged"; cutoff: string; archiveId: string; rowCount: number; deleted: number; storagePath: string }
  | { status: "failed"; cutoff: string; step: "read" | "upload" | "register" | "purge"; error: string };

const kstDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);

/** 기준 시각: (지금 − 365일)이 속한 한국 날짜의 0시. 항상 지금 − 365일 이전이라 DB 의 보존 검사를 통과한다. */
export function retentionCutoff(now = new Date()): Date {
  const day = kstDate(new Date(now.getTime() - AUDIT_RETENTION_DAYS * 86_400_000));
  return new Date(`${day}T00:00:00+09:00`);
}

const MESSAGES: Record<string, string> = {
  RETENTION_NOT_REACHED: "보존 기간(1년)이 지나지 않은 기록은 정리할 수 없습니다.",
  NOTHING_TO_ARCHIVE: "보존 기간이 지난 기록이 없습니다.",
  ARCHIVE_MISMATCH: "아카이브와 현재 기록이 일치하지 않아 삭제를 중단했습니다.",
  ARCHIVE_NOT_FOUND: "아카이브 기록을 찾을 수 없습니다.",
  ALREADY_PURGED: "이미 삭제를 마친 아카이브입니다.",
};

export function retentionErrorMessage(code: string | undefined | null): string {
  const key = Object.keys(MESSAGES).find((k) => code?.includes(k));
  return (key && MESSAGES[key]) || "감사 로그 정리 중 오류가 발생했습니다.";
}

async function rowsBefore(admin: Client, cutoff: string): Promise<AuditLogRow[]> {
  const rows: AuditLogRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("audit_logs")
      .select("*")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.code ?? "read failed");
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

export async function runAuditRetention(
  admin: Client,
  options: { actorId: string | null; now?: Date },
): Promise<RetentionResult> {
  const cutoffDate = retentionCutoff(options.now);
  const cutoff = cutoffDate.toISOString();

  let rows: AuditLogRow[];
  try {
    rows = await rowsBefore(admin, cutoff);
  } catch (error) {
    return { status: "failed", cutoff, step: "read", error: error instanceof Error ? error.message : "read failed" };
  }
  if (rows.length === 0) return { status: "nothing", cutoff };

  const csv = Buffer.from(auditCsvKorean(rows), "utf8");
  const sha256 = createHash("sha256").update(csv).digest("hex");
  const day = kstDate(cutoffDate);
  const storagePath = `${day.slice(0, 4)}/audit-logs-before-${day}-${Date.now()}.csv`;

  const upload = await admin.storage.from(AUDIT_ARCHIVE_BUCKET).upload(storagePath, csv, { contentType: "text/csv", upsert: false });
  if (upload.error) return { status: "failed", cutoff, step: "upload", error: upload.error.message };

  const registered = await admin.rpc("register_audit_archive", {
    p_cutoff: cutoff,
    p_row_count: rows.length,
    p_file_sha256: sha256,
    p_file_size: csv.byteLength,
    p_storage_path: storagePath,
    p_actor_id: options.actorId ?? undefined,
  });
  if (registered.error || !registered.data) {
    // 등록되지 않은 파일은 남기지 않는다(다음 실행에서 새로 만든다)
    await admin.storage.from(AUDIT_ARCHIVE_BUCKET).remove([storagePath]);
    return { status: "failed", cutoff, step: "register", error: registered.error?.message ?? "register failed" };
  }

  const purged = await admin.rpc("purge_archived_audit_logs", { p_archive_id: registered.data, p_actor_id: options.actorId ?? undefined });
  if (purged.error) {
    // 아카이브는 남아 있으므로 기록은 하나도 사라지지 않았다. 다음 실행이 새 아카이브로 다시 시도한다.
    return { status: "failed", cutoff, step: "purge", error: purged.error.message };
  }
  return { status: "purged", cutoff, archiveId: registered.data, rowCount: rows.length, deleted: purged.data ?? 0, storagePath };
}

/** 보존 기간이 지난 기록 건수(화면 안내용, service_role) */
export async function countExpiredAuditLogs(admin: Client, now = new Date()): Promise<number> {
  const { count, error } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .lt("created_at", retentionCutoff(now).toISOString());
  if (error) throw new Error(error.code ?? "count failed");
  return count ?? 0;
}
