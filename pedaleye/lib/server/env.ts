import "server-only";

// 서버 전용 설정·시크릿 접근 모듈. 클라이언트 번들에 포함되면 빌드가 실패합니다.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경 변수가 설정되지 않았습니다.`);
  return value;
}

export function getServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

/** 초대 링크 등 외부로 전달하는 URL 의 기준 주소. 요청 Host 헤더를 믿지 않기 위해 설정값을 쓴다. */
export function getAppBaseUrl(): string {
  return required("APP_BASE_URL").replace(/\/+$/, "");
}
