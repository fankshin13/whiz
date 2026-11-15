import "server-only";

import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";

import { allowedRolesForPath, type UserRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  orgId: string | null;
};

/** Auth 서버로 세션을 검증(getUser)한 뒤 public.users 프로필을 반환. 미로그인이면 null. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    // 세션 없음 / 만료·폐기된 토큰은 미로그인으로 처리, 그 외(네트워크 등)는 오류로 올린다.
    if (isAuthSessionMissingError(error) || error.status === 401 || error.status === 403) {
      return null;
    }
    throw new Error(`세션 확인 실패 (status ${error.status ?? "unknown"})`);
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, email, name, role, org_id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) throw new Error(`사용자 프로필 조회 실패 (${profileError.code})`);
  if (!profile) throw new Error("인증된 사용자의 프로필이 없습니다.");

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    orgId: profile.org_id,
  };
});

/** 보호 페이지 가드: 미로그인은 로그인 화면으로, 권한 없는 역할은 403. */
export async function requireUserForPath(pathname: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/auth/login?redirect=${encodeURIComponent(pathname)}`);
  }
  const roles = allowedRolesForPath(pathname);
  if (roles && !roles.includes(user.role)) {
    forbidden();
  }
  return user;
}
