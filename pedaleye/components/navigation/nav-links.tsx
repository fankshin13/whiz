"use client";

import { AlertTriangle, Building2, Car, Cpu, LayoutDashboard, ScrollText, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeNavHref, type NavIconName, type NavItem } from "./nav-config";

const ICONS: Record<NavIconName, LucideIcon> = {
  LayoutDashboard,
  Car,
  AlertTriangle,
  SlidersHorizontal,
  Cpu,
  Building2,
  ScrollText,
  Users,
};

export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname, items);

  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {items.map((item) => {
        const Icon = ICONS[item.iconName];
        const active = item.href === activeHref;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-(--size-touch) items-center gap-3 rounded-md px-3 font-semibold no-underline ${
                active
                  ? "bg-primary-action text-primary-action-fg"
                  : "text-text-main hover:bg-border"
              }`}
            >
              <Icon aria-hidden="true" size={20} strokeWidth={2} />
              <span>{item.title}</span>
              {item.badge ? <span className="ml-auto text-caption">{item.badge}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
