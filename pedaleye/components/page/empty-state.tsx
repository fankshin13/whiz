import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-3 rounded-lg border border-dashed border-border-strong bg-bg-base px-6 py-10 text-center">
      <Icon aria-hidden="true" size={28} className="text-text-muted" />
      <p className="m-0 font-semibold">{title}</p>
      {children ? <div className="m-0 max-w-md text-text-muted">{children}</div> : null}
    </div>
  );
}
