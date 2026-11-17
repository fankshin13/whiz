import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { CurrentUser } from "@/lib/auth/get-current-user";
import type { UserRole } from "@/lib/auth/roles";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type Operator = Pick<CurrentUser, "id" | "role" | "orgId">;

const NO_PERMISSION = "이 작업을 수행할 권한이 없습니다.";
const TEMPORARY_FAILURE = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
export const USERS_PAGE_SIZE = 20;
const ROLES = ["super_admin", "org_admin", "driver", "investigator"] as const;

export const userFilterSchema = z.object({
  org: z.guid().optional().catch(undefined),
  role: z.enum(ROLES).optional().catch(undefined),
  status: z.enum(["active", "inactive"]).optional().catch(undefined),
  q: z.string().trim().max(50).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});
export type UserFilter = z.infer<typeof userFilterSchema>;

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  orgId: string | null;
  orgName: string | null;
  vehicles: { id: string; plateNumber: string }[];
  isActive: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  deactivatedAt: string | null;
}

function canManageUsers(user: Operator): boolean {
  return user.role === "super_admin" || (user.role === "org_admin" && user.orgId !== null);
}

/** PostgREST or() 문법을 깨뜨릴 수 있는 문자 제거 */
function safeSearch(term: string): string {
  return term.replace(/[,()*%\\:"']/g, " ").trim();
}

/**
 * 사용자 목록. 슈퍼 관리자 전체(조직 필터 가능), 조직 관리자는 자기 조직 운전자·조사관만(서버 고정 + RLS).
 * 최근 로그인 시각은 DB 함수 user_last_sign_in 이 같은 범위에서만 돌려준다.
 */
export async function listUsers(
  supabase: Client,
  user: Operator,
  filter: UserFilter,
): Promise<{ users: UserListItem[]; total: number; page: number; totalPages: number }> {
  if (!canManageUsers(user)) throw new Error("FORBIDDEN");

  let query = supabase
    .from("users")
    .select(
      "id, email, name, role, org_id, is_active, created_at, deactivated_at, organization:organizations(name), vehicles:vehicles!vehicles_assigned_user_id_fkey(id, plate_number)",
      { count: "exact" },
    )
    .order("is_active", { ascending: false })
    .order("name")
    .order("id");

  if (user.role === "org_admin") {
    query = query.eq("org_id", user.orgId ?? "").in("role", ["driver", "investigator"]);
  } else if (filter.org) {
    query = query.eq("org_id", filter.org);
  }
  if (filter.role) query = query.eq("role", filter.role);
  if (filter.status) query = query.eq("is_active", filter.status === "active");

  const term = filter.q ? safeSearch(filter.q) : "";
  if (term) {
    // 차량 번호로도 찾는다: 번호가 맞는 차량의 배정 운전자 id 를 함께 조건에 넣는다
    const { data: matched, error } = await supabase.from("vehicles").select("assigned_user_id").ilike("plate_number", `%${term}%`).limit(100);
    if (error) throw new Error(`차량 검색 실패 (${error.code})`);
    const ids = matched.map((v) => v.assigned_user_id).filter((id): id is string => !!id);
    const byVehicle = ids.length ? `,id.in.(${ids.join(",")})` : "";
    query = query.or(`name.ilike."*${term}*",email.ilike."*${term}*"${byVehicle}`);
  }

  const page = filter.page;
  const { data, error, count } = await query.range((page - 1) * USERS_PAGE_SIZE, page * USERS_PAGE_SIZE - 1);
  if (error) throw new Error(`사용자 목록 조회 실패 (${error.code})`);

  const lastSignIn = new Map<string, string | null>();
  if (data.length > 0) {
    const { data: signIns, error: signInError } = await supabase.rpc("user_last_sign_in", { p_user_ids: data.map((u) => u.id) });
    if (signInError) throw new Error(`최근 로그인 조회 실패 (${signInError.code})`);
    for (const row of signIns) lastSignIn.set(row.id, row.last_sign_in_at);
  }

  const total = count ?? data.length;
  return {
    users: data.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      orgId: row.org_id,
      orgName: row.organization?.name ?? null,
      vehicles: row.vehicles.map((v) => ({ id: v.id, plateNumber: v.plate_number })),
      isActive: row.is_active,
      createdAt: row.created_at,
      lastSignInAt: lastSignIn.get(row.id) ?? null,
      deactivatedAt: row.deactivated_at,
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)),
  };
}

const setActiveSchema = z.object({
  userId: z.guid(),
  active: z.boolean(),
  unassignVehicle: z.boolean().default(true),
  demote: z.boolean().default(false),
  reason: z.string().trim().max(200, "사유는 200자 이하로 입력해 주세요.").optional(),
});

const SET_ACTIVE_ERRORS: Record<string, string> = {
  FORBIDDEN: NO_PERMISSION,
  USER_NOT_FOUND: "사용자를 찾을 수 없거나 관리 권한이 없습니다.",
  SELF: "본인 계정은 비활성화할 수 없습니다.",
  LAST_SUPER_ADMIN: "시스템의 마지막 슈퍼 관리자는 비활성화할 수 없습니다.",
  INVALID_DEMOTE: "운전자 강등은 슈퍼 관리자가 조직 관리자에게만 할 수 있습니다.",
};

export type SetActiveResult = { ok: true; changed: boolean; unassigned: string[] } | { ok: false; error: string };

/**
 * 계정 비활성화·재활성화(또는 조직 관리자 강등). DB 함수 set_user_active 가 권한 확인, 상태 변경,
 * 차량 배정 해제, 로그인 차단·세션 폐기, 감사 기록을 한 트랜잭션으로 처리한다.
 */
export async function setUserActive(supabase: Client, user: Operator, input: unknown): Promise<SetActiveResult> {
  if (!canManageUsers(user)) return { ok: false, error: NO_PERMISSION };
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
  if (parsed.data.userId === user.id) return { ok: false, error: SET_ACTIVE_ERRORS.SELF ?? NO_PERMISSION };

  const { data, error } = await supabase.rpc("set_user_active", {
    p_user_id: parsed.data.userId,
    p_active: parsed.data.active,
    p_unassign_vehicle: parsed.data.unassignVehicle,
    p_demote: parsed.data.demote,
    p_reason: parsed.data.reason ?? undefined,
  });
  if (error) {
    const known = SET_ACTIVE_ERRORS[error.message];
    if (known) return { ok: false, error: known };
    if (error.code === "42501") return { ok: false, error: NO_PERMISSION };
    console.error("setUserActive failed", { code: error.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  const result = data as { changed: boolean; unassigned: string[] };
  return { ok: true, changed: result.changed, unassigned: result.unassigned };
}
