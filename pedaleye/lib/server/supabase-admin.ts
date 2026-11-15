import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServiceRoleKey } from "@/lib/server/env";
import type { Database } from "@/lib/supabase/database.types";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

/**
 * RLS 를 우회하는 service_role 클라이언트. 호출 전에 반드시 작업 권한을 따로 확인할 것.
 * 현재 용도: 초대 토큰(유일한 인가 수단) 검증과 초대 수락 시 계정 생성.
 */
export function createAdminClient() {
  return createClient<Database>(getSupabasePublicEnv().url, getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
