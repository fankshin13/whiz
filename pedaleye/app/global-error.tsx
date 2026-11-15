"use client";

import "./globals.css";

// 루트 레이아웃까지 실패했을 때의 마지막 화면. 자체 html/body 를 가진다.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body>
        <main className="grid min-h-dvh place-items-center bg-bg-panel px-4 py-8">
          <div className="card grid w-full max-w-110 gap-4">
            <h1 className="m-0 text-h1 font-bold">서비스에 일시적인 문제가 생겼습니다</h1>
            <p className="m-0 text-text-muted" role="alert">
              일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.
            </p>
            <button type="button" className="btn" onClick={reset}>
              다시 시도
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
