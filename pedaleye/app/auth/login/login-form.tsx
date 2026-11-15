"use client";

import { useActionState } from "react";

import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = { error: null, email: "" };

export function LoginForm({ redirectTo }: { redirectTo: string | null }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="card" style={{ display: "grid", gap: "var(--space-4)" }} noValidate>
      <div aria-live="polite">
        {state.error ? (
          <p className="alert" role="alert" style={{ margin: 0 }}>
            <strong>로그인 실패: </strong>
            {state.error}
          </p>
        ) : null}
      </div>

      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

      <div className="field">
        <label htmlFor="email">이메일</label>
        <input
          key={state.email}
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          defaultValue={state.email}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="password">비밀번호</label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          minLength={8}
          required
        />
      </div>

      <button type="submit" className="button" disabled={pending} aria-disabled={pending}>
        {pending ? (
          <>
            <span className="spinner" aria-hidden="true" />
            인증 확인 중...
          </>
        ) : (
          "로그인"
        )}
      </button>
    </form>
  );
}
