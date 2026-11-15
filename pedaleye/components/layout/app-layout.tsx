import type { ReactNode } from "react";

import { navItemsForRole } from "@/components/navigation/nav-config";

import { LogoutButton } from "./logout-button";
import { MobileNav } from "./mobile-nav";
import { Sidebar } from "./sidebar";
import { UserSummary, type ShellUser } from "./user-summary";

export function AppLayout({ user, children }: { user: ShellUser; children: ReactNode }) {
  const items = navItemsForRole(user.role);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-20 focus:rounded-md focus:bg-bg-base focus:p-3"
      >
        본문으로 건너뛰기
      </a>
      <Sidebar items={items} user={user} />
      <MobileNav
        items={items}
        footer={
          <>
            <UserSummary user={user} />
            <LogoutButton />
          </>
        }
      />
      <main id="main" className="lg:pl-(--size-sidebar)">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
