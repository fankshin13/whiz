import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { CurrentUser } from "@/lib/auth/get-current-user";
import type { Database } from "@/lib/supabase/database.types";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

/**
 * 모바일 앱 요청의 `Authorization: Bearer <Supabase 액세스 토큰>` 을 Auth 서버로 검증(getUser)하고,
 * 그 토큰으로 동작하는(RLS 적용) 사용자 클라이언트와 프로필을 돌려준다. 토큰이 없거나 무효면 null.
 */
export async function getBearerUser(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(header)?.[1];
  if (!token) return null;

  const { url, anonKey } = getSupabasePublicEnv();
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    if (error && (error.status ?? 0) >= 500) throw new Error(`토큰 확인 실패 (status ${error.status})`);
    return null;
  }

  const { data: profile, error: profileError } = await client
    .from("users")
    .select("id, email, name, role, org_id")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) throw new Error(`사용자 프로필 조회 실패 (${profileError.code})`);
  if (!profile) return null;

  const user: CurrentUser = {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    orgId: profile.org_id,
  };
  return { client, user };
}
