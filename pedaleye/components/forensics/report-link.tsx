"use client";

import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";

/** 보고서 다운로드. 변조 세션이면 증거 능력 경고를 먼저 확인받는다. */
export function ReportLink({ sessionId, tampered }: { sessionId: string; tampered: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const href = `/events/${sessionId}/report?autoPrint=true`;

  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => (tampered ? dialogRef.current?.showModal() : router.push(href))}
      >
        <FileText aria-hidden="true" size={18} />
        보고서 다운로드
      </button>
      {tampered ? (
        <dialog
          ref={dialogRef}
          aria-labelledby="tamper-confirm-title"
          className="m-auto w-[min(440px,calc(100vw-32px))] rounded-lg border border-critical bg-bg-base p-0 text-text-main backdrop:bg-text-main/50"
        >
          <div className="grid gap-4 p-6">
            <h2 id="tamper-confirm-title" className="m-0 text-h2 font-semibold">
              변조가 감지된 데이터입니다
            </h2>
            <p className="m-0">법적 증거로 채택되지 않을 수 있습니다. 변조 사실이 표시된 보고서를 출력할까요?</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => dialogRef.current?.close()}>
                취소
              </button>
              <button type="button" className="btn" onClick={() => router.push(href)}>
                변조 보고서 출력
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
