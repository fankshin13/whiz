import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { postLoginPath, safeInternalPath } from "@/lib/auth/roles";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "로그인 | 페달아이" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[] }>;
}) {
  const params = await searchParams;
  const requested = safeInternalPath(typeof params.redirect === "string" ? params.redirect : null);

  const user = await getCurrentUser();
  if (user) redirect(postLoginPath(user.role, requested));

  return (
    <main className="page" style={{ maxWidth: 440, minHeight: "100dvh", alignContent: "center" }}>
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <h1>페달아이 로그인</h1>
        <p className="muted" style={{ margin: 0 }}>
          관리자에게 받은 계정의 이메일과 비밀번호를 입력해 주세요.
        </p>
      </div>
      <LoginForm redirectTo={requested} />
    </main>
  );
}
