import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { CurrentUser } from "@/lib/auth/get-current-user";
import type { UserRole } from "@/lib/auth/roles";
import { generateInvitationToken, hashInvitationToken, isWellFormedToken } from "@/lib/invitations/token";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type Operator = Pick<CurrentUser, "id" | "role" | "orgId">;

const TEMPORARY_FAILURE = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";

// ── 초대 생성 ────────────────────────────────────────────────────────────

export const createInvitationSchema = z.object({
  vehicleId: z.guid(),
  name: z.string().trim().min(1, "운전자 이름을 입력해 주세요.").max(50),
  email: z.email("이메일 형식을 확인해 주세요.").transform((value) => value.toLowerCase()),
  expiresInHours: z.coerce.number().int().min(1).max(168).default(24),
});

export type CreateInvitationResult =
  | { ok: true; invitationUrl: string; expiresAt: string; expiresInHours: number }
  | { ok: false; error: string };

/** 관리자가 차량 배정용 운전자 초대 링크를 만든다. 조직은 차량에서 정하며 RLS 가 2차로 검증한다. */
export async function createInvitation(
  supabase: Client,
  user: Operator,
  input: unknown,
  baseUrl: string,
): Promise<CreateInvitationResult> {
  if (user.role !== "super_admin" && user.role !== "org_admin") {
    return { ok: false, error: "운전자를 초대할 권한이 없습니다." };
  }

  const parsed = createInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
  }
  const { vehicleId, name, email, expiresInHours } = parsed.data;

  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .select("id, org_id, assigned_user_id")
    .eq("id", vehicleId)
    .maybeSingle();
  if (vehicleError) {
    console.error("createInvitation vehicle lookup failed", { code: vehicleError.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  if (!vehicle || (user.role === "org_admin" && vehicle.org_id !== user.orgId)) {
    return { ok: false, error: "차량 배정 권한이 없습니다." };
  }
  if (vehicle.assigned_user_id) {
    return { ok: false, error: "이미 운전자가 배정된 차량입니다." };
  }

  const nowIso = new Date().toISOString();
  const { data: active, error: activeError } = await supabase
    .from("invitations")
    .select("email, vehicle_id")
    .eq("org_id", vehicle.org_id)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", nowIso);
  if (activeError) {
    console.error("createInvitation active lookup failed", { code: activeError.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  if (active.some((row) => row.email === email)) {
    return { ok: false, error: "이미 해당 이메일로 활성화된 초대가 존재합니다." };
  }
  if (active.some((row) => row.vehicle_id === vehicleId)) {
    return { ok: false, error: "이 차량에 아직 수락되지 않은 초대가 있습니다. 기존 초대를 취소하거나 재발급해 주세요." };
  }

  const token = generateInvitationToken();
  const expiresAt = new Date(Date.now() + expiresInHours * 3_600_000).toISOString();

  const { error: insertError } = await supabase.from("invitations").insert({
    org_id: vehicle.org_id,
    vehicle_id: vehicleId,
    email,
    invitee_name: name,
    role: "driver",
    token_hash: hashInvitationToken(token),
    expires_at: expiresAt,
    created_by: user.id,
  });
  if (insertError) {
    if (insertError.code === "42501") return { ok: false, error: "차량 배정 권한이 없습니다." };
    console.error("createInvitation insert failed", { code: insertError.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }

  return {
    ok: true,
    invitationUrl: `${baseUrl}/auth/invite?token=${token}`,
    expiresAt,
    expiresInHours,
  };
}

// ── 조직 관리자 초대(슈퍼 관리자 전용) ───────────────────────────────────

export const createOrgAdminInvitationSchema = z.object({
  orgId: z.guid("조직을 찾을 수 없습니다."),
  name: z.string().trim().min(1, "관리자 이름을 입력해 주세요.").max(50),
  email: z.email("이메일 형식을 확인해 주세요.").transform((value) => value.toLowerCase()),
  expiresInHours: z.coerce.number().int().min(1).max(168).default(24),
});

/**
 * 조직 관리자(org_admin) 1회용 초대 링크. 차량은 붙이지 않는다.
 * 서버에서 슈퍼 관리자인지 확인하고, RLS(invitations_insert)가 한 번 더 막는다.
 */
export async function createOrgAdminInvitation(
  supabase: Client,
  user: Operator,
  input: unknown,
  baseUrl: string,
): Promise<CreateInvitationResult> {
  if (user.role !== "super_admin") return { ok: false, error: "조직 관리자를 초대할 권한이 없습니다." };

  const parsed = createOrgAdminInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
  }
  const { orgId, name, email, expiresInHours } = parsed.data;

  const [org, existingUser, active] = await Promise.all([
    supabase.from("organizations").select("id").eq("id", orgId).maybeSingle(),
    supabase.from("users").select("id").eq("email", email).maybeSingle(),
    supabase
      .from("invitations")
      .select("id")
      .eq("email", email)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()),
  ]);
  for (const failed of [org.error, existingUser.error, active.error]) {
    if (failed) {
      console.error("createOrgAdminInvitation lookup failed", { code: failed.code });
      return { ok: false, error: TEMPORARY_FAILURE };
    }
  }
  if (!org.data) return { ok: false, error: "조직을 찾을 수 없습니다." };
  if (existingUser.data) return { ok: false, error: "이미 가입된 이메일입니다. 다른 이메일로 초대해 주세요." };
  if ((active.data ?? []).length > 0) return { ok: false, error: "이미 해당 이메일로 활성화된 초대가 존재합니다." };

  const token = generateInvitationToken();
  const expiresAt = new Date(Date.now() + expiresInHours * 3_600_000).toISOString();
  const { error: insertError } = await supabase.from("invitations").insert({
    org_id: orgId,
    vehicle_id: null,
    email,
    invitee_name: name,
    role: "org_admin",
    token_hash: hashInvitationToken(token),
    expires_at: expiresAt,
    created_by: user.id,
  });
  if (insertError) {
    if (insertError.code === "42501") return { ok: false, error: "조직 관리자를 초대할 권한이 없습니다." };
    console.error("createOrgAdminInvitation insert failed", { code: insertError.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }

  return { ok: true, invitationUrl: `${baseUrl}/auth/invite?token=${token}`, expiresAt, expiresInHours };
}

// ── 초대 조회(토큰 검증) ─────────────────────────────────────────────────

export type InvitationFailure = "NOT_FOUND" | "ALREADY_USED" | "EXPIRED" | "REVOKED";

export type InvitationLookup =
  | { valid: true; email: string; inviteeName: string; orgName: string; vehiclePlate: string | null; role: UserRole }
  | { valid: false; reason: InvitationFailure };

/** 토큰으로 초대를 찾는다. service_role 클라이언트 전용(토큰 자체가 인가 수단). 내부 ID·해시는 돌려주지 않는다. */
export async function lookupInvitation(admin: Client, rawToken: string): Promise<InvitationLookup> {
  if (!isWellFormedToken(rawToken)) return { valid: false, reason: "NOT_FOUND" };

  const { data, error } = await admin
    .from("invitations")
    .select("email, invitee_name, role, expires_at, used_at, revoked_at, organizations(name), vehicles(plate_number)")
    .eq("token_hash", hashInvitationToken(rawToken))
    .maybeSingle();
  if (error) throw new Error(`초대 조회 실패 (${error.code})`);

  if (!data) return { valid: false, reason: "NOT_FOUND" };
  if (data.revoked_at) return { valid: false, reason: "REVOKED" };
  if (data.used_at) return { valid: false, reason: "ALREADY_USED" };
  if (new Date(data.expires_at).getTime() <= Date.now()) return { valid: false, reason: "EXPIRED" };

  return {
    valid: true,
    email: data.email,
    inviteeName: data.invitee_name,
    orgName: data.organizations?.name ?? "",
    vehiclePlate: data.vehicles?.plate_number ?? null,
    role: data.role,
  };
}

// ── 초대 수락 ────────────────────────────────────────────────────────────

export const acceptInvitationSchema = z
  .object({
    token: z.string(),
    password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다.").max(72, "비밀번호는 72자 이하로 입력해 주세요."),
    passwordConfirm: z.string(),
  })
  .refine((value) => value.password === value.passwordConfirm, {
    message: "비밀번호 확인이 일치하지 않습니다.",
    path: ["passwordConfirm"],
  });

export type AcceptInvitationResult =
  | { ok: true; email: string; role: UserRole }
  | { ok: false; reason: InvitationFailure | "INVALID_INPUT" | "EMAIL_EXISTS" | "VEHICLE_UNAVAILABLE" | "FAILED"; error?: string };

const KNOWN_DB_FAILURES = ["NOT_FOUND", "ALREADY_USED", "EXPIRED", "REVOKED", "VEHICLE_UNAVAILABLE"] as const;

/**
 * 1) 토큰 확인 → 2) Auth 계정 생성 → 3) DB 함수 한 트랜잭션으로 토큰 소모·조직/역할·차량 배정.
 * 3단계가 실패하면 2단계에서 만든 계정을 지워 중복·고아 계정을 남기지 않는다.
 */
export async function acceptInvitation(admin: Client, input: unknown): Promise<AcceptInvitationResult> {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID_INPUT", error: parsed.error.issues[0]?.message };
  }
  const { token, password } = parsed.data;

  const invitation = await lookupInvitation(admin, token);
  if (!invitation.valid) return { ok: false, reason: invitation.reason };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
    user_metadata: { name: invitation.inviteeName },
  });
  if (createError) {
    if (createError.code === "email_exists") return { ok: false, reason: "EMAIL_EXISTS" };
    console.error("acceptInvitation createUser failed", { status: createError.status, code: createError.code });
    return { ok: false, reason: "FAILED" };
  }

  const userId = created.user.id;
  const { data: role, error: acceptError } = await admin.rpc("accept_invitation", {
    p_token_hash: hashInvitationToken(token),
    p_user_id: userId,
  });

  if (acceptError) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) console.error("acceptInvitation cleanup deleteUser failed", { status: deleteError.status });

    const known = KNOWN_DB_FAILURES.find((reason) => reason === acceptError.message);
    if (known) return { ok: false, reason: known };
    console.error("acceptInvitation rpc failed", { code: acceptError.code });
    return { ok: false, reason: "FAILED" };
  }

  return { ok: true, email: invitation.email, role };
}
