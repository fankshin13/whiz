"use client";

import { useActionState } from "react";

import { acceptInvitationAction, type AcceptInvitationState } from "@/lib/invitations/actions";

const initialState: AcceptInvitationState = { error: null };

export function InviteAcceptForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction, initialState);

  return (
    <form action={formAction} className="grid gap-4" aria-busy={pending}>
      <div aria-live="polite">
        {state.error ? (
          <p className="alert m-0" role="alert">
            <strong>등록 실패: </strong>
            {state.error}
          </p>
        ) : null}
      </div>

      <input type="hidden" name="token" value={token} />

      <div className="grid gap-1">
        <label htmlFor="password" className="font-semibold">
          접속 비밀번호 설정
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
          aria-describedby="password-hint"
          disabled={pending}
        />
        <span id="password-hint" className="text-caption text-text-muted">
          8자 이상. 영문·숫자·특수문자를 섞으면 더 안전합니다.
        </span>
      </div>

      <div className="grid gap-1">
        <label htmlFor="passwordConfirm" className="font-semibold">
          비밀번호 확인
        </label>
        <input
          id="passwordConfirm"
          name="passwordConfirm"
          type="password"
          className="input"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
          disabled={pending}
        />
      </div>

      <button type="submit" className="btn" disabled={pending}>
        {pending ? (
          <>
            <span className="spinner" aria-hidden="true" />
            계정 등록 및 세션 생성 중...
          </>
        ) : (
          "등록 완료 및 대시보드 시작"
        )}
      </button>
    </form>
  );
}
