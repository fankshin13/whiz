import { allowedRolesForPath, type UserRole } from "@/lib/auth/roles";

export type NavIconName = "LayoutDashboard" | "Car" | "AlertTriangle" | "SlidersHorizontal" | "Building2";

export interface NavItem {
  title: string;
  href: string;
  iconName: NavIconName; // Lucide 아이콘 이름
  badge?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { title: "대시보드", href: "/dashboard", iconName: "LayoutDashboard" },
  { title: "차량 관리", href: "/vehicles", iconName: "Car" },
  { title: "사고 이벤트", href: "/events", iconName: "AlertTriangle" },
  { title: "페달 캘리브레이션", href: "/devices/calibrate", iconName: "SlidersHorizontal" },
  { title: "조직 관리", href: "/admin/organizations", iconName: "Building2" },
];

/** 역할이 접근할 수 있는 메뉴만 노출(눌러도 403이 되는 메뉴는 숨김). */
export function navItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => allowedRolesForPath(item.href)?.includes(role));
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
