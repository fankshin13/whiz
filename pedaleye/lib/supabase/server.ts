import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

import type { Database } from "@/lib/supabase/database.types";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { clientIpFromHeaders } from "@/lib/server/rate-limit";

/** Server Component · Server Action · Route Handler 용 Supabase 클라이언트. */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicEnv();
  // 감사 로그가 실제 접속자 IP 를 남기도록 DB 요청에 함께 보낸다(DB 함수 private.audit_request_ip 가 읽음)
  const ip = clientIpFromHeaders(await headers());

  return createServerClient<Database>(url, anonKey, {
    global: { headers: { "x-pedaleye-client-ip": ip } },
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
