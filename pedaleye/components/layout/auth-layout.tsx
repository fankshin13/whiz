import type { ReactNode } from "react";

import { Brand } from "./brand";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg-panel px-4 py-8">
      <div className="grid w-full max-w-110 gap-6">
        <Brand />
        {children}
      </div>
    </main>
  );
}
