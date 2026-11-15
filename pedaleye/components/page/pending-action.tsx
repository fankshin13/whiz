import type { ReactNode } from "react";

/** 기능이 아직 연결되지 않은 주요 동작 버튼. 비활성 상태와 이유를 함께 알린다. */
export function PendingAction({ children, id }: { children: ReactNode; id: string }) {
  return (
    <div className="grid justify-items-start gap-1 sm:justify-items-end">
      <button type="button" className="btn" disabled aria-describedby={`${id}-note`}>
        {children}
      </button>
      <span id={`${id}-note`} className="text-caption text-text-muted">
        준비 중인 기능입니다
      </span>
    </div>
  );
}
