import "server-only";

import { createClient as createSupabaseClient, isAuthSessionMissingError } from "@supabase/supabase-js";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";

import { allowedRolesForPath, type UserRole } from "@/lib/auth/roles";
import type { Database } from "@/lib/supabase/database.types";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  orgId: string | null;
};

type SessionLookup = { user: CurrentUser | null; deactivated: boolean };

/**
 * 비활성화하면 서버 세션이 폐기되어 getUser 가 '세션 없음'이 된다(이때 클라이언트는 세션을 지운다).
 * 그래서 getUser 전에 쿠키의 접근 토큰을 잡아 두었다가, 실패하면 그 토큰(아직 만료 전)으로 본인 행을 읽어
 * 비활성 계정인지 확인한다. 토큰 검증은 DB(PostgREST)가 하므로 위조 토큰은 아무 행도 못 읽는다.
 * 안내 문구를 보여 줄지 정하는 용도로만 쓴다(권한 판단에 쓰지 않음).
 */
async function wasDeactivated(accessToken: string | undefined): Promise<boolean> {
  if (!accessToken) return false;
  let userId: unknown;
  try {
    userId = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")).sub;
  } catch {
    return false;
  }
  if (typeof userId !== "string") return false;
  const { url, anonKey } = getSupabasePublicEnv();
  const client = createSupabaseClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: row } = await client.from("users").select("is_active").eq("id", userId).maybeSingle();
  return row?.is_active === false;
}

/** Auth 서버로 세션을 검증(getUser)한 뒤 public.users 프로필을 읽는다. 비활성 계정은 deactivated. */
const loadSession = cache(async (): Promise<SessionLookup> => {
  const supabase = await createClient();
  // 비활성 계정 안내용으로만 쓰는 쿠키 속 토큰(검증 전 값). 권한 판단은 아래 getUser 결과로만 한다
  const { data: cached } = await supabase.auth.getSession();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    // 세션 없음 / 만료·폐기된 토큰은 미로그인으로 처리, 그 외(네트워크 등)는 오류로 올린다.
    if (isAuthSessionMissingError(error) || error.status === 401 || error.status === 403) {
      return { user: null, deactivated: await wasDeactivated(cached.session?.access_token) };
    }
    throw new Error(`세션 확인 실패 (status ${error.status ?? "unknown"})`);
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, email, name, role, org_id, is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) throw new Error(`사용자 프로필 조회 실패 (${profileError.code})`);
  if (!profile) throw new Error("인증된 사용자의 프로필이 없습니다.");
  if (!profile.is_active) return { user: null, deactivated: true };

  return {
    user: { id: profile.id, email: profile.email, name: profile.name, role: profile.role, orgId: profile.org_id },
    deactivated: false,
  };
});

/** 지금 쿠키의 세션이 비활성화된 계정의 것인지(로그인 화면 안내용) */
export async function isDeactivatedSession(): Promise<boolean> {
  return (await loadSession()).deactivated;
}

/** 로그인한 활성 사용자. 미로그인·비활성 계정은 null(서버 액션은 로그인 필요로 처리). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => (await loadSession()).user);

/** 보호 페이지 가드: 미로그인은 로그인 화면으로, 권한 없는 역할은 403. */
export async function requireUserForPath(pathname: string): Promise<CurrentUser> {
  const { user, deactivated } = await loadSession();
  // 비활성화된 계정: 세션을 지우고 안내와 함께 로그인 화면으로
  if (deactivated) redirect("/auth/deactivated");
  if (!user) {
    redirect(`/auth/login?redirect=${encodeURIComponent(pathname)}`);
  }
  const roles = allowedRolesForPath(pathname);
  if (roles && !roles.includes(user.role)) {
    forbidden();
  }
  return user;
}
