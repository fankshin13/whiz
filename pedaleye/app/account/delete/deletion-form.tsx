"use client";

import { UserX } from "lucide-react";
import { useActionState } from "react";

import { ACCOUNT_DELETION_CONFIRM } from "@/lib/account/deletion";

import { requestDeletionAction, type DeletionState } from "./actions";

const initialState: DeletionState = { status: "idle" };

export function DeletionForm() {
  const [state, formAction, pending] = useActionState(requestDeletionAction, initialState);

  if (state.status === "done") {
    return (
      <div role="status" className="card grid gap-2">
        <strong>계정 삭제 요청이 접수되었습니다.</strong>
        <p className="m-0">
          계정은 지금 비활성화되어 앱과 웹에 로그인할 수 없습니다. 보관 기간이 지나면 남은 정보도 파기됩니다.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="card grid gap-4" aria-busy={pending}>
      <div aria-live="polite">
        {state.status === "error" ? (
          <p className="alert m-0" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      <div className="grid gap-1">
        <label htmlFor="del-email" className="font-semibold">이메일</label>
        <input
          key={state.status === "error" ? state.email : ""}
          id="del-email"
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          defaultValue={state.status === "error" ? state.email : ""}
          required
          disabled={pending}
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor="del-password" className="font-semibold">비밀번호</label>
        <input id="del-password" name="password" type="password" className="input" autoComplete="current-password" required disabled={pending} />
      </div>
      <div className="grid gap-1">
        <label htmlFor="del-reason" className="font-semibold">
          사유 <span className="font-normal text-text-muted">(선택)</span>
        </label>
        <input id="del-reason" name="reason" className="input" maxLength={150} disabled={pending} />
      </div>
      <div className="grid gap-1">
        <label htmlFor="del-confirm" className="font-semibold">
          확인 문구 입력 <span className="font-normal text-text-muted">({ACCOUNT_DELETION_CONFIRM})</span>
        </label>
        <input id="del-confirm" name="confirm" className="input" autoComplete="off" required disabled={pending} />
      </div>
      <button type="submit" className="btn border-critical bg-critical text-white" disabled={pending}>
        {pending ? <span className="spinner" aria-hidden="true" /> : <UserX aria-hidden="true" size={18} />}
        {pending ? "요청 처리 중..." : "계정 삭제 요청"}
      </button>
    </form>
  );
}
