"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page" style={{ maxWidth: 520 }}>
      <h1>화면을 불러오지 못했습니다</h1>
      <p className="muted" style={{ margin: 0 }} role="alert">
        일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.
      </p>
      <button type="button" className="button" style={{ justifySelf: "start" }} onClick={reset}>
        다시 시도
      </button>
    </main>
  );
}
