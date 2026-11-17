import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** 비활성화된 계정의 남은 세션 쿠키를 지우고 안내와 함께 로그인 화면으로 보낸다. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    const { data: profile } = await supabase.from("users").select("is_active").eq("id", data.user.id).maybeSingle();
    // 활성 계정은 여기서 로그아웃시키지 않는다(링크만으로 남을 로그아웃시키는 것 방지)
    if (profile?.is_active) return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  // 서버 세션은 비활성화 때 이미 폐기됐으므로 이 기기의 쿠키만 지운다
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/auth/login?error=deactivated", request.url));
}
