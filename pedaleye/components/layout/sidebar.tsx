import { NavLinks } from "@/components/navigation/nav-links";
import type { NavItem } from "@/components/navigation/nav-config";

import { Brand } from "./brand";
import { LogoutButton } from "./logout-button";
import { UserSummary, type ShellUser } from "./user-summary";

export function Sidebar({ items, user }: { items: NavItem[]; user: ShellUser }) {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-(--size-sidebar) flex-col border-r border-border bg-bg-panel lg:flex">
      <div className="flex h-(--size-header) items-center border-b border-border px-6">
        <Brand />
      </div>
      <nav aria-label="주 메뉴" className="flex-1 overflow-y-auto p-4">
        <NavLinks items={items} />
      </nav>
      <div className="grid gap-3 border-t border-border p-4">
        <UserSummary user={user} />
        <LogoutButton />
      </div>
    </aside>
  );
}
