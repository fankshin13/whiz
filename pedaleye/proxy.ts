import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { allowedRolesForPath } from "@/lib/auth/roles";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

// 매 요청마다 Supabase 세션 쿠키를 갱신하고, 보호 라우트의 미인증 접근을 로그인으로 보낸다.
// 역할 검사는 각 페이지의 requireUserForPath(서버)가 2차로 수행한다.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabasePublicEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const { pathname, search } = request.nextUrl;

  if (!data?.claims && allowedRolesForPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/auth/login";
    loginUrl.search = `?redirect=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
