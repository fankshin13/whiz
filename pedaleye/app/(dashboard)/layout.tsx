import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppLayout } from "@/components/layout/app-layout";
import { getCurrentUser } from "@/lib/auth/get-current-user";

// 역할별 접근 검사는 각 페이지의 requireUserForPath 가 수행한다.
export default async function DashboardGroupLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  return <AppLayout user={{ name: user.name, email: user.email, role: user.role }}>{children}</AppLayout>;
}
