import { z } from "zod";

/**
 * 서버 환경 변수 규칙. server-only 를 붙이지 않은 이유: next.config.ts(빌드 시점)에서도 같은 규칙으로
 * 검사해 설정이 틀린 운영 배포를 막기 위함. 시크릿 값 자체는 이 파일에서 읽어 내보내지 않는다.
 */
export const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_TIMEZONE: z.literal("Asia/Seoul"),
  APP_BASE_URL: z.url().transform((value) => value.replace(/\/+$/, "")),
  NTP_SERVER_HOST: z.string().min(1).default("time.google.com"),
  // Vercel Cron 이 Authorization: Bearer 로 보내는 값. 없으면 자동 정리(감사 로그 보존)가 꺼진다.
  CRON_SECRET: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(16).optional()),
  // 자동 작업 결과를 받는 외부 감시 서비스 주소(예: https://hc-ping.com/<uuid>). 없으면 신호를 보내지 않는다.
  CRON_HEARTBEAT_URL: z.preprocess((value) => (value === "" ? undefined : value), z.url({ protocol: /^https$/ }).optional()),
  // 개인정보처리방침(/privacy) 게시 정보. 넷 다 있어야 공개된다(없으면 '준비 중').
  PRIVACY_CONTROLLER: z.preprocess((value) => (value === "" ? undefined : value), z.string().max(100).optional()),
  PRIVACY_OFFICER: z.preprocess((value) => (value === "" ? undefined : value), z.string().max(100).optional()),
  PRIVACY_CONTACT: z.preprocess((value) => (value === "" ? undefined : value), z.string().max(200).optional()),
  PRIVACY_EFFECTIVE_DATE: z.preprocess((value) => (value === "" ? undefined : value), z.iso.date().optional()),
  EVENT_BUFFER_WINDOW_SEC: z.coerce.number().int().positive().default(30),
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** 값이 아닌 변수 이름과 문제만 담아 오류를 던진다(시크릿이 로그에 남지 않게). */
export function validateServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
    throw new Error(`[CRITICAL] 잘못되었거나 누락된 서버 환경 변수: ${details}`);
  }
  return result.data;
}

