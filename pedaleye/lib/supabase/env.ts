// 클라이언트 공개 값만 다룬다. 서버 시크릿은 lib/server/env.ts 에서만 읽는다.
export function getSupabasePublicEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 환경 변수가 설정되지 않았습니다.");
  }
  return { url, anonKey };
}
