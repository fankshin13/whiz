"use client";

import { AuthLayout } from "@/components/layout/auth-layout";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AuthLayout>
      <div className="card grid gap-4">
        <h1 className="m-0 text-h1 font-bold">화면을 불러오지 못했습니다</h1>
        <p className="m-0 text-text-muted" role="alert">
          일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <button type="button" className="btn" onClick={reset}>
          다시 시도
        </button>
      </div>
    </AuthLayout>
  );
}
