import { createHash } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { AUDIT_ARCHIVE_BUCKET, retentionCutoff, runAuditRetention } from "@/lib/audit/retention";

import { adminClient, signedInClient } from "./helpers";

// 감사 로그 보존: 1년이 지난 기록만, 아카이브(파일 + DB 등록)를 남긴 뒤에만 지울 수 있다.
const SUPER_ID = "20000000-0000-0000-0000-000000000001";
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const uploaded: string[] = [];

async function insertLog(createdAt: string, name: string) {
  const { data, error } = await adminClient()
    .from("audit_logs")
    .insert({
      actor_name: "보존 시험",
      action_type: "ORG_UPDATE",
      target_type: "organization",
      target_id: name,
      target_display_name: name,
      created_at: createdAt,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function exists(id: string) {
  const { data } = await adminClient().from("audit_logs").select("id").eq("id", id).maybeSingle();
  return data !== null;
}

afterAll(async () => {
  if (uploaded.length) await adminClient().storage.from(AUDIT_ARCHIVE_BUCKET).remove(uploaded);
});

describe("보존 기준 시각", () => {
  it("(지금 − 365일)이 속한 한국 날짜의 0시이며 항상 365일보다 이전이다", () => {
    const now = new Date("2026-11-21T00:30:00+09:00");
    expect(retentionCutoff(now).toISOString()).toBe("2025-11-20T15:00:00.000Z"); // 2025-11-21 00:00 KST
    expect(retentionCutoff(now).getTime()).toBeLessThanOrEqual(now.getTime() - 365 * DAY);
  });
});

describe("불변 규칙", () => {
  it("1년이 지난 기록이라도 정리 함수 밖에서는 지우거나 고칠 수 없다", async () => {
    const id = await insertLog(daysAgo(800), "retention-direct");
    const admin = adminClient();
    const del = await admin.from("audit_logs").delete().eq("id", id);
    expect(del.error?.message).toMatch(/수정하거나 삭제할 수 없습니다/);
    const upd = await admin.from("audit_logs").update({ actor_name: "변조" }).eq("id", id);
    expect(upd.error?.message).toMatch(/수정하거나 삭제할 수 없습니다/);
    expect(await exists(id)).toBe(true);
  });

  it("로그인 사용자(슈퍼 관리자 포함)는 등록·삭제 함수를 호출할 수 없다", async () => {
    const client = await signedInClient("super@pedaleye.test");
    const reg = await client.rpc("register_audit_archive", {
      p_cutoff: daysAgo(400), p_row_count: 1, p_file_sha256: "0".repeat(64), p_file_size: 1, p_storage_path: "x.csv",
    });
    expect(reg.error?.code).toBe("42501");
    const purge = await client.rpc("purge_archived_audit_logs", { p_archive_id: "00000000-0000-0000-0000-000000000000" });
    expect(purge.error?.code).toBe("42501");
  });

  it("보존 기간이 안 된 기준 시각과 틀린 건수는 등록을 거부한다", async () => {
    const admin = adminClient();
    const early = await admin.rpc("register_audit_archive", {
      p_cutoff: daysAgo(300), p_row_count: 1, p_file_sha256: "0".repeat(64), p_file_size: 1, p_storage_path: "early.csv",
    });
    expect(early.error?.message).toMatch(/RETENTION_NOT_REACHED/);
    const wrong = await admin.rpc("register_audit_archive", {
      p_cutoff: retentionCutoff().toISOString(), p_row_count: 999_999, p_file_sha256: "0".repeat(64), p_file_size: 1, p_storage_path: "wrong.csv",
    });
    expect(wrong.error?.message).toMatch(/ARCHIVE_MISMATCH/);
  });
});

describe("아카이브 후 삭제", () => {
  it("아카이브 뒤 대상 기록이 바뀌면 삭제를 거부하고 아무것도 지우지 않는다", async () => {
    const admin = adminClient();
    const cutoff = retentionCutoff().toISOString();
    const { count } = await admin.from("audit_logs").select("id", { count: "exact", head: true }).lt("created_at", cutoff);
    const reg = await admin.rpc("register_audit_archive", {
      p_cutoff: cutoff, p_row_count: count ?? 0, p_file_sha256: "a".repeat(64), p_file_size: 10, p_storage_path: `test/mismatch-${Date.now()}.csv`,
    });
    expect(reg.error).toBeNull();
    const late = await insertLog(daysAgo(700), "retention-late"); // 아카이브에 없는 기록
    const purge = await admin.rpc("purge_archived_audit_logs", { p_archive_id: reg.data! });
    expect(purge.error?.message).toMatch(/ARCHIVE_MISMATCH/);
    expect(await exists(late)).toBe(true);
  });

  it("1년이 지난 기록만 CSV 로 보관한 뒤 지우고, 그 과정이 감사 로그에 남는다", async () => {
    const old = [await insertLog(daysAgo(400), "retention-old-1"), await insertLog(daysAgo(500), "retention-old-2")];
    const recent = await insertLog(daysAgo(300), "retention-recent");

    const result = await runAuditRetention(adminClient(), { actorId: SUPER_ID });
    expect(result.status).toBe("purged");
    if (result.status !== "purged") return;
    uploaded.push(result.storagePath);
    expect(result.deleted).toBe(result.rowCount);
    for (const id of old) expect(await exists(id)).toBe(false);
    expect(await exists(recent)).toBe(true);

    const admin = adminClient();
    const { data: archive } = await admin.from("audit_log_archives").select("*").eq("id", result.archiveId).single();
    expect(archive).toMatchObject({ row_count: result.rowCount, purged_count: result.deleted, created_by: SUPER_ID });
    expect(archive?.purged_at).not.toBeNull();

    // 저장소 파일 = 등록된 지문, 삭제된 기록이 모두 들어 있다
    const file = await admin.storage.from(AUDIT_ARCHIVE_BUCKET).download(result.storagePath);
    const bytes = Buffer.from(await file.data!.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(archive?.file_sha256);
    const text = bytes.toString("utf8");
    expect(text).toContain("retention-old-1");
    expect(text).toContain("retention-old-2");
    expect(text).not.toContain("retention-recent");

    const { data: logs } = await admin
      .from("audit_logs")
      .select("action_type, actor_id, changes_summary")
      .eq("target_id", result.archiveId)
      .order("created_at");
    expect(logs?.map((l) => l.action_type)).toEqual(["AUDIT_ARCHIVE", "AUDIT_PURGE"]);
    expect(logs?.[1]).toMatchObject({ actor_id: SUPER_ID, changes_summary: { deleted_count: result.deleted, mode: "manual" } });
  });

  it("정리할 기록이 없으면 아무것도 만들지 않는다", async () => {
    expect((await runAuditRetention(adminClient(), { actorId: null })).status).toBe("nothing");
  });

  it("아카이브 기록은 지우거나 고칠 수 없고, 이미 지운 아카이브는 다시 실행되지 않는다", async () => {
    const admin = adminClient();
    const { data: archive } = await admin.from("audit_log_archives").select("id").not("purged_at", "is", null).limit(1).single();
    const upd = await admin.from("audit_log_archives").update({ row_count: 1 }).eq("id", archive!.id);
    expect(upd.error?.message).toMatch(/수정하거나 삭제할 수 없습니다/);
    const del = await admin.from("audit_log_archives").delete().eq("id", archive!.id);
    expect(del.error?.message).toMatch(/수정하거나 삭제할 수 없습니다/);
    const again = await admin.rpc("purge_archived_audit_logs", { p_archive_id: archive!.id });
    expect(again.error?.message).toMatch(/ALREADY_PURGED/);
  });

  it("아카이브 내려받기는 수행자와 함께 감사 로그에 남는다", async () => {
    const admin = adminClient();
    const { data: archive } = await admin.from("audit_log_archives").select("id").limit(1).single();
    const { error } = await admin.rpc("record_audit_archive_download", { p_archive_id: archive!.id, p_actor_id: SUPER_ID });
    expect(error).toBeNull();
    const { data: logs } = await admin
      .from("audit_logs")
      .select("action_type, actor_id")
      .eq("target_id", archive!.id)
      .eq("action_type", "AUDIT_ARCHIVE_DOWNLOAD");
    expect(logs?.[0]).toMatchObject({ actor_id: SUPER_ID });
  });

  it("아카이브 목록은 슈퍼 관리자만 볼 수 있다", async () => {
    const superList = await (await signedInClient("super@pedaleye.test")).from("audit_log_archives").select("id");
    expect(superList.data?.length).toBeGreaterThan(0);
    const orgAdmin = await (await signedInClient("admin.hwaseong@pedaleye.test")).from("audit_log_archives").select("id");
    expect(orgAdmin.data).toEqual([]);
  });
});
