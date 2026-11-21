import "server-only";

import { validateServerEnv } from "@/lib/server/env-schema";

/**
 * 서버 전용 설정·시크릿 접근 모듈(클라이언트 번들에 포함되면 빌드가 실패한다).
 * 서버 기동 시 instrumentation.ts, Vercel 빌드 시 next.config.ts 가 같은 규칙으로 검사한다.
 */
export { validateServerEnv, type ServerEnv } from "@/lib/server/env-schema";

export function getServiceRoleKey(): string {
  return validateServerEnv().SUPABASE_SERVICE_ROLE_KEY;
}

/** 초대 링크·보고서 QR 등 외부로 전달하는 URL 의 기준 주소. 요청 Host 헤더를 믿지 않기 위해 설정값을 쓴다. */
export function getAppBaseUrl(): string {
  return validateServerEnv().APP_BASE_URL;
}

/** 자동 작업(Vercel Cron) 인증 값. 설정하지 않으면 null(자동 작업 비활성). */
export function getCronSecret(): string | null {
  return validateServerEnv().CRON_SECRET ?? null;
}

/** 자동 작업 하트비트 주소(외부 감시 서비스). 설정하지 않으면 null. */
export function getCronHeartbeatUrl(): string | null {
  return validateServerEnv().CRON_HEARTBEAT_URL ?? null;
}

/** 개인정보처리방침 게시 정보. 하나라도 없으면 null(페이지는 '준비 중'). */
export function getPrivacyInfo(): { controller: string; officer: string; contact: string; effectiveDate: string } | null {
  const env = validateServerEnv();
  if (!env.PRIVACY_CONTROLLER || !env.PRIVACY_OFFICER || !env.PRIVACY_CONTACT || !env.PRIVACY_EFFECTIVE_DATE) return null;
  return { controller: env.PRIVACY_CONTROLLER, officer: env.PRIVACY_OFFICER, contact: env.PRIVACY_CONTACT, effectiveDate: env.PRIVACY_EFFECTIVE_DATE };
}
