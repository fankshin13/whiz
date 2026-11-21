import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { AUDIT_ARCHIVE_BUCKET } from "@/lib/audit/retention";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { clientIpFromHeaders } from "@/lib/server/rate-limit";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 감사 로그 아카이브 파일 내려받기(슈퍼 관리자). 내려받기도 감사 로그에 남기고, 60초짜리 서명 주소로 보낸다. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("로그인이 필요합니다.", { status: 401 });
  if (user.role !== "super_admin") return new Response("권한이 없습니다.", { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return new Response("아카이브를 찾을 수 없습니다.", { status: 404 });

  // 조회는 로그인 세션으로(RLS: 슈퍼 관리자만 보인다)
  const { data: archive } = await (await createClient()).from("audit_log_archives").select("id, storage_path").eq("id", id).maybeSingle();
  if (!archive) return new Response("아카이브를 찾을 수 없습니다.", { status: 404 });

  const admin = createAdminClient(clientIpFromHeaders(await headers()));
  const logged = await admin.rpc("record_audit_archive_download", { p_archive_id: archive.id, p_actor_id: user.id });
  if (logged.error) return new Response("내려받기 기록을 남기지 못해 중단했습니다.", { status: 500 });

  const fileName = archive.storage_path.split("/").at(-1) ?? "audit-archive.csv";
  const signed = await admin.storage.from(AUDIT_ARCHIVE_BUCKET).createSignedUrl(archive.storage_path, 60, { download: fileName });
  if (signed.error || !signed.data) return new Response("아카이브 파일을 찾을 수 없습니다.", { status: 404 });
  return NextResponse.redirect(signed.data.signedUrl, { status: 303, headers: { "cache-control": "no-store" } });
}
