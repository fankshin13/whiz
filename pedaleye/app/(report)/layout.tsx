import type { ReactNode } from "react";

// 인쇄 전용 문서 레이아웃: 사이드바 없이 A4 폭으로 표시한다.
export default function ReportLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-bg-panel px-4 py-6 print:bg-bg-base print:p-0">{children}</div>;
}
