"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

/** 공통 대화상자 틀: 제목·설명·닫기 버튼, 바깥 누르면 닫힘 */
export function ModalDialog({
  id,
  title,
  description,
  dialogRef,
  onClose,
  children,
}: {
  id: string;
  title: string;
  description: string;
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-[min(480px,calc(100vw-32px))] rounded-lg border border-border bg-bg-base p-0 text-text-main backdrop:bg-text-main/50"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="grid gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 id={`${id}-title`} className="m-0 text-h2 font-semibold">
              {title}
            </h2>
            <p className="m-0 text-text-muted">{description}</p>
          </div>
          <button
            type="button"
            className="btn btn-secondary shrink-0 px-0"
            aria-label="창 닫기"
            onClick={() => dialogRef.current?.close()}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
