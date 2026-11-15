import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { homePathForRole } from "@/lib/auth/roles";

// 앱 셸(<main>) 안에 그려지므로 자체 <main> 을 두지 않는다.
export default async function Forbidden() {
  const user = await getCurrentUser();
  const home = user ? homePathForRole(user.role) : "/auth/login";

  return (
    <div className="card grid max-w-xl gap-4">
      <ShieldAlert aria-hidden="true" size={28} className="text-brake" />
      <h1 className="m-0 text-h1 font-bold">접근 권한 없음</h1>
      <p className="m-0 text-text-muted">해당 페이지에 접근할 권한이 없습니다.</p>
      <Link href={home} className="btn justify-self-start">
        {home === "/events" ? "사고 이벤트로 돌아가기" : "대시보드로 돌아가기"}
      </Link>
    </div>
  );
}
