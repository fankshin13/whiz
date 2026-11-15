"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button type="button" className="btn print:hidden" onClick={() => window.print()}>
      <Printer aria-hidden="true" size={18} />
      PDF로 인쇄
    </button>
  );
}
