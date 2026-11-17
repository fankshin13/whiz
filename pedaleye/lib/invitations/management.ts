import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { CurrentUser } from "@/lib/auth/get-current-user";
import type { UserRole } from "@/lib/auth/roles";
import { generateInvitationToken, hashInvitationToken } from "@/lib/invitations/token";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type Operator = Pick<CurrentUser, "id" | "role" | "orgId">;

const NO_PERMISSION = "이 작업을 수행할 권한이 없습니다.";
const TEMPORARY_FAILURE = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
export const INVITATIONS_PAGE_SIZE = 20;

export type InvitationStatus = "PENDING" | "EXPIRED" | "ACCEPTED" | "REVOKED";
export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  PENDING: "대기",
  EXPIRED: "만료",
  ACCEPTED: "수락 완료",
  REVOKED: "취소됨",
};

export const invitationFilterSchema = z.object({
  istatus: z.enum(["PENDING", "EXPIRED", "ACCEPTED", "REVOKED"]).optional().catch(undefined),
  ipage: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});
export type InvitationFilter = z.infer<typeof invitationFilterSchema>;

export interface InvitationListItem {
  id: string;
  email: string;
  inviteeName: string;
  role: UserRole;
  orgName: string | null;
  vehicleId: string | null;
  vehiclePlate: string | null;
  status: InvitationStatus;
  createdByName: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

export function invitationStatus(row: { used_at: string | null; revoked_at: string | null; expires_at: string }, now = Date.now()): InvitationStatus {
  if (row.revoked_at) return "REVOKED";
  if (row.used_at) return "ACCEPTED";
  if (new Date(row.expires_at).getTime() <= now) return "EXPIRED";
  return "PENDING";
}

function canManage(user: Operator): boolean {
  return user.role === "super_admin" || (user.role === "org_admin" && user.orgId !== null);
}

/** 초대 목록(최근 순). 슈퍼 관리자 전체, 조직 관리자는 자기 조직의 운전자·조사관 초대만. */
export async function listInvitations(
  supabase: Client,
  user: Operator,
  filter: InvitationFilter,
): Promise<{ items: InvitationListItem[]; total: number; page: number; totalPages: number }> {
  if (!canManage(user)) throw new Error("FORBIDDEN");
  const nowIso = new Date().toISOString();
  let query = supabase
    .from("invitations")
    .select(
      "id, email, invitee_name, role, vehicle_id, created_at, expires_at, used_at, revoked_at, organization:organizations(name), vehicle:vehicles(plate_number), creator:users!invitations_created_by_fkey(name)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id");
  if (user.role === "org_admin") query = query.eq("org_id", user.orgId ?? "").in("role", ["driver", "investigator"]);

  switch (filter.istatus) {
    case "REVOKED":
      query = query.not("revoked_at", "is", null);
      break;
    case "ACCEPTED":
      query = query.not("used_at", "is", null);
      break;
    case "EXPIRED":
      query = query.is("revoked_at", null).is("used_at", null).lte("expires_at", nowIso);
      break;
    case "PENDING":
      query = query.is("revoked_at", null).is("used_at", null).gt("expires_at", nowIso);
      break;
  }

  const page = filter.ipage;
  const { data, error, count } = await query.range((page - 1) * INVITATIONS_PAGE_SIZE, page * INVITATIONS_PAGE_SIZE - 1);
  if (error) throw new Error(`초대 목록 조회 실패 (${error.code})`);
  const total = count ?? data.length;
  return {
    items: data.map((row) => ({
      id: row.id,
      email: row.email,
      inviteeName: row.invitee_name,
      role: row.role,
      orgName: row.organization?.name ?? null,
      vehicleId: row.vehicle_id,
      vehiclePlate: row.vehicle?.plate_number ?? null,
      status: invitationStatus(row),
      createdByName: row.creator?.name ?? null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      revokedAt: row.revoked_at,
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / INVITATIONS_PAGE_SIZE)),
  };
}

const ERRORS: Record<string, string> = {
  FORBIDDEN: NO_PERMISSION,
  NOT_FOUND: "초대를 찾을 수 없거나 관리 권한이 없습니다.",
  ALREADY_USED: "이미 수락된 초대입니다.",
  EMAIL_EXISTS: "이미 가입된 이메일입니다. 새 초대가 필요하지 않습니다.",
  VEHICLE_UNAVAILABLE: "차량에 이미 다른 운전자가 배정되어 재발급할 수 없습니다.",
  ACTIVE_EXISTS: "같은 이메일 또는 차량에 다른 대기 초대가 있습니다. 그 초대를 먼저 취소해 주세요.",
  INVALID_INPUT: "유효 시간을 다시 선택해 주세요.",
};

function mapError(error: { message: string; code: string }, op: string): string {
  const known = ERRORS[error.message];
  if (known) return known;
  if (error.code === "42501") return NO_PERMISSION;
  console.error(`${op} failed`, { code: error.code });
  return TEMPORARY_FAILURE;
}

/** 초대 취소(멱등). 수락된 초대는 취소할 수 없다. 권한·잠금·감사 기록은 DB 함수 revoke_invitation. */
export async function revokeInvitation(supabase: Client, user: Operator, input: unknown): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  if (!canManage(user)) return { ok: false, error: NO_PERMISSION };
  const parsed = z.object({ invitationId: z.guid(), reason: z.string().trim().max(200).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "초대를 찾을 수 없습니다." };
  const { data, error } = await supabase.rpc("revoke_invitation", { p_invitation_id: parsed.data.invitationId, p_reason: parsed.data.reason ?? undefined });
  if (error) return { ok: false, error: mapError(error, "revokeInvitation") };
  return { ok: true, changed: (data as { changed: boolean }).changed };
}

export const REISSUE_HOURS = [24, 48, 72] as const;

/** 재발급: 기존 링크 취소 + 새 1회용 링크(한 트랜잭션). 원문 토큰은 여기서 만들고 DB 에는 해시만 저장한다. */
export async function reissueInvitation(
  supabase: Client,
  user: Operator,
  input: unknown,
  baseUrl: string,
): Promise<{ ok: true; invitationUrl: string; expiresAt: string; expiresInHours: number } | { ok: false; error: string }> {
  if (!canManage(user)) return { ok: false, error: NO_PERMISSION };
  const parsed = z
    .object({ invitationId: z.guid(), expiresInHours: z.coerce.number().pipe(z.union(REISSUE_HOURS.map((h) => z.literal(h)))).default(24) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: ERRORS.INVALID_INPUT ?? TEMPORARY_FAILURE };

  const token = generateInvitationToken();
  const { data, error } = await supabase.rpc("reissue_invitation", {
    p_invitation_id: parsed.data.invitationId,
    p_token_hash: hashInvitationToken(token),
    p_expires_in_hours: parsed.data.expiresInHours,
  });
  if (error) return { ok: false, error: mapError(error, "reissueInvitation") };
  const result = data as { expires_at: string };
  return { ok: true, invitationUrl: `${baseUrl}/auth/invite?token=${token}`, expiresAt: result.expires_at, expiresInHours: parsed.data.expiresInHours };
}
