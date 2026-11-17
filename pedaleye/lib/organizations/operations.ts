import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { CurrentUser } from "@/lib/auth/get-current-user";
import type { OrganizationType } from "@/lib/organizations/labels";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type Operator = Pick<CurrentUser, "role">;

export interface OrganizationSummary {
  id: string;
  name: string;
  type: OrganizationType;
  createdAt: string;
  vehicleCount: number;
  adminCount: number;
}

const FORBIDDEN = "조직을 관리할 권한이 없습니다.";
const TEMPORARY_FAILURE = "조직 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";

/** 슈퍼 관리자용 조직 목록과 조직별 차량·관리자 수(최신순). 다른 역할이면 빈 목록. */
export async function listOrganizationsWithStats(supabase: Client, user: Operator): Promise<OrganizationSummary[]> {
  if (user.role !== "super_admin") return [];
  const [orgs, vehicles, admins] = await Promise.all([
    supabase.from("organizations").select("id, name, type, created_at").order("created_at", { ascending: false }),
    supabase.from("vehicles").select("org_id"),
    supabase.from("users").select("org_id").eq("role", "org_admin"),
  ]);
  if (orgs.error) throw new Error(`조직 목록 조회 실패 (${orgs.error.code})`);
  if (vehicles.error) throw new Error(`차량 수 조회 실패 (${vehicles.error.code})`);
  if (admins.error) throw new Error(`관리자 수 조회 실패 (${admins.error.code})`);

  const count = (rows: { org_id: string | null }[]) =>
    rows.reduce<Map<string, number>>((map, row) => {
      if (row.org_id) map.set(row.org_id, (map.get(row.org_id) ?? 0) + 1);
      return map;
    }, new Map());
  const vehicleCounts = count(vehicles.data);
  const adminCounts = count(admins.data);

  return orgs.data.map((org) => ({
    id: org.id,
    name: org.name,
    type: org.type,
    createdAt: org.created_at,
    vehicleCount: vehicleCounts.get(org.id) ?? 0,
    adminCount: adminCounts.get(org.id) ?? 0,
  }));
}

const fields = {
  name: z.string().trim().min(2, "조직명은 2자 이상이어야 합니다.").max(50, "조직명은 50자 이하로 입력해 주세요."),
  type: z.enum(["b2g", "fleet", "standard"], { error: "조직 유형을 선택해 주세요." }),
};
export const createOrganizationSchema = z.object(fields);
export const updateOrganizationSchema = z.object({ id: z.guid("조직을 찾을 수 없습니다."), ...fields });

export type OrganizationResult = { ok: true; id: string } | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "입력값을 확인해 주세요.";
}

/** 조직 생성(슈퍼 관리자 전용). 서버에서 역할을 확인하고 RLS(organizations_insert)가 한 번 더 막는다. */
export async function createOrganization(supabase: Client, user: Operator, input: unknown): Promise<OrganizationResult> {
  if (user.role !== "super_admin") return { ok: false, error: FORBIDDEN };
  const parsed = createOrganizationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const { data, error } = await supabase.from("organizations").insert(parsed.data).select("id").single();
  if (error) {
    if (error.code === "42501") return { ok: false, error: FORBIDDEN };
    console.error("createOrganization failed", { code: error.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  return { ok: true, id: data.id };
}

/** 조직 이름·유형 수정(슈퍼 관리자 전용) */
export async function updateOrganization(supabase: Client, user: Operator, input: unknown): Promise<OrganizationResult> {
  if (user.role !== "super_admin") return { ok: false, error: FORBIDDEN };
  const parsed = updateOrganizationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { id, name, type } = parsed.data;

  const { data, error } = await supabase.from("organizations").update({ name, type }).eq("id", id).select("id");
  if (error) {
    if (error.code === "42501") return { ok: false, error: FORBIDDEN };
    console.error("updateOrganization failed", { code: error.code });
    return { ok: false, error: TEMPORARY_FAILURE };
  }
  if (data.length === 0) return { ok: false, error: "조직을 찾을 수 없습니다." };
  return { ok: true, id };
}
