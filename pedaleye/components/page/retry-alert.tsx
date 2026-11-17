"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** 서버 조회 실패 안내 + 같은 화면 다시 불러오기 */
export function RetryAlert({ message }: { message: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="alert" className="alert grid gap-3">
      <p className="m-0">{message}</p>
      <button type="button" className="btn justify-self-start" disabled={pending} onClick={() => start(() => router.refresh())}>
        {pending ? <span className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" size={18} />}
        다시 시도
      </button>
    </div>
  );
}
