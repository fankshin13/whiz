import type { ReactNode } from "react";

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="card grid gap-4">
      <h2 id={id} className="m-0 text-h2 font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
