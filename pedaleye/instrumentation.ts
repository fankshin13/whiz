// 서버 기동 시 한 번 실행된다. 필수 환경 변수가 없거나 형식이 틀리면 기동을 막는다.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateServerEnv } = await import("@/lib/server/env");
  validateServerEnv();
}
