import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser, isDeactivatedSession } from "@/lib/auth/get-current-user";
import { postLoginPath, safeInternalPath } from "@/lib/auth/roles";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "로그인 | 페달아이" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const requested = safeInternalPath(typeof params.redirect === "string" ? params.redirect : null);

  const user = await getCurrentUser();
  if (user) redirect(postLoginPath(user.role, requested));
  // 비활성화 직후 남은 세션으로 들어온 경우(보호 페이지에서 돌려보내짐)도 안내한다
  const deactivated = params.error === "deactivated" || (await isDeactivatedSession());

  return (
    <>
      <div className="grid gap-2">
        <h1 className="m-0 text-h1 font-bold">관리자 콘솔 로그인</h1>
        <p className="m-0 text-text-muted">관리자에게 받은 계정의 이메일과 비밀번호를 입력해 주세요.</p>
      </div>
      {deactivated ? (
        <p role="alert" className="alert m-0">
          관리자에 의해 비활성화된 계정입니다. 소속 관리자에게 문의하세요.
        </p>
      ) : null}
      <LoginForm redirectTo={requested} />
      <nav aria-label="이용 안내" className="flex flex-wrap justify-center gap-4 text-caption text-text-muted">
        <Link href="/privacy" className="underline">개인정보처리방침</Link>
        <Link href="/account/delete" className="underline">계정 삭제 요청</Link>
      </nav>
    </>
  );
}
