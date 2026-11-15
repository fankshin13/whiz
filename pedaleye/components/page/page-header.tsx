import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="grid min-w-0 gap-1">
        <h1 className="m-0 text-h1 font-bold">{title}</h1>
        <p className="m-0 text-text-muted">{description}</p>
      </div>
      {action}
    </header>
  );
}
