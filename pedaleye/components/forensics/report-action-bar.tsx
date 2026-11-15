"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

/** 화면 상단 인쇄 도구(인쇄물에는 나오지 않음). autoPrint 면 열리자마자 인쇄 창을 띄운다. */
export function ReportActionBar({ sessionId, autoPrint }: { sessionId: string; autoPrint: boolean }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 글꼴까지 불러온 뒤 인쇄해야 레이아웃이 어긋나지 않는다
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      setReady(true);
      if (autoPrint) window.print();
    });
    return () => {
      cancelled = true;
    };
  }, [autoPrint]);

  return (
    <div className="mx-auto grid w-full max-w-[210mm] gap-2 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/events/${sessionId}`} className="btn btn-secondary">
          <ArrowLeft aria-hidden="true" size={18} />
          세션 상세로
        </Link>
        <button type="button" className="btn" onClick={() => window.print()} disabled={!ready} aria-busy={!ready}>
          {ready ? <Printer aria-hidden="true" size={18} /> : <span className="spinner" aria-hidden="true" />}
          A4 인쇄 / PDF 저장
        </button>
      </div>
      <p className="m-0 text-caption text-text-muted">
        인쇄 창에서 대상(프린터)을 &lsquo;PDF로 저장&rsquo;으로, 용지를 A4로 고르고 &lsquo;배경 그래픽&rsquo;을 켜면 색과 무늬가 그대로
        저장됩니다. 머리글·바닥글 옵션은 끄는 것을 권장합니다.
      </p>
    </div>
  );
}
