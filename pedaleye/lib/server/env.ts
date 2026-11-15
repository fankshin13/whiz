import "server-only";

// 서버 전용 시크릿 접근 모듈. 클라이언트 번들에 포함되면 빌드가 실패합니다.
export function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 환경 변수가 설정되지 않았습니다.");
  }
  return key;
}
