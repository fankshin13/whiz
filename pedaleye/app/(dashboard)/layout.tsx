import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppLayout } from "@/components/layout/app-layout";
import { getCurrentUser, isDeactivatedSession } from "@/lib/auth/get-current-user";

// 역할별 접근 검사는 각 페이지의 requireUserForPath 가 수행한다.
export default async function DashboardGroupLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  // 비활성화된 계정은 남은 세션 쿠키를 지우고 안내 화면으로
  if (!user) redirect((await isDeactivatedSession()) ? "/auth/deactivated" : "/auth/login");

  return <AppLayout user={{ name: user.name, email: user.email, role: user.role }}>{children}</AppLayout>;
}
