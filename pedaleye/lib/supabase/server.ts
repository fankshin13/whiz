import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/supabase/database.types";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

/** Server Component · Server Action · Route Handler 용 Supabase 클라이언트. */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component 렌더 중에는 쿠키를 쓸 수 없다(Next가 예외를 던짐).
          // 세션 갱신 쿠키는 proxy.ts 가 매 요청마다 기록하므로 여기서는 의도적으로 건너뛴다.
        }
      },
    },
  });
}
