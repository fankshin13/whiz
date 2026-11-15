"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { verifySessionIntegrityAction, type ReverifyState } from "@/app/(dashboard)/events/[id]/actions";

export function ReverifyButton({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<ReverifyState>({ ok: null, message: null });
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="grid justify-items-start gap-1 sm:justify-items-end">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setState(await verifySessionIntegrityAction(sessionId));
            router.refresh();
          })
        }
      >
        {pending ? <span className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" size={18} />}
        {pending ? "해시 체인 계산 중..." : "무결성 재검증 실행"}
      </button>
      <span role="status" className="text-caption text-text-muted" data-reverify-message>
        {state.message}
      </span>
    </div>
  );
}
