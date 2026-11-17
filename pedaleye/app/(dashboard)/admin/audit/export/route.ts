import { AUDIT_ACTION_LABELS, ROLE_LABELS } from "@/lib/audit/labels";
import { AUDIT_EXPORT_LIMIT, auditCsv, auditFilterSchema, listAuditLogs } from "@/lib/audit/operations";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { allowedRolesForPath } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const timeFormat = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Seoul" });

/** 현재 조회 조건의 감사 로그를 CSV(UTF-8 BOM)로 내려준다. 조직 관리자는 자기 조직만. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("로그인이 필요합니다.", { status: 401 });
  if (!allowedRolesForPath("/admin/audit/export")?.includes(user.role)) return new Response("권한이 없습니다.", { status: 403 });

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filter = auditFilterSchema.parse({ ...params, page: 1 });
  try {
    const { rows } = await listAuditLogs(await createClient(), user, filter, { limit: AUDIT_EXPORT_LIMIT });
    const csv = auditCsv(rows, {
      action: (a) => AUDIT_ACTION_LABELS[a],
      role: (r) => (r ? (ROLE_LABELS[r] ?? r) : "시스템"),
      time: (iso) => timeFormat.format(new Date(iso)),
    });
    const stamp = timeFormat.format(new Date()).replace(/[-: ]/g, "").replace(/^(\d{8})/, "$1_");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit_logs_${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("audit export failed", { message: error instanceof Error ? error.message : "unknown" });
    return new Response("감사 로그를 내보내지 못했습니다.", { status: 500 });
  }
}
