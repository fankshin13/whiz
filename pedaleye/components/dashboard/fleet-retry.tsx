"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function FleetRetry() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="alert" className="alert grid gap-3" data-fleet-error>
      <p className="m-0">관제 데이터를 불러오는 중 오류가 발생했습니다.</p>
      <button type="button" className="btn justify-self-start" disabled={pending} onClick={() => start(() => router.refresh())}>
        {pending ? <span className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" size={18} />}
        다시 시도
      </button>
    </div>
  );
}
