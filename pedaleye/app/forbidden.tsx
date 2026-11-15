import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { homePathForRole } from "@/lib/auth/roles";

export default async function Forbidden() {
  const user = await getCurrentUser();
  const home = user ? homePathForRole(user.role) : "/auth/login";

  return (
    <main className="page" style={{ maxWidth: 520 }}>
      <h1>접근 권한 없음</h1>
      <p className="muted" style={{ margin: 0 }}>해당 페이지에 접근할 권한이 없습니다.</p>
      <Link href={home} className="button" style={{ justifySelf: "start" }}>
        {home === "/events" ? "사고 이벤트로 돌아가기" : "대시보드로 돌아가기"}
      </Link>
    </main>
  );
}
