import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

import { AuthLayout } from "@/components/layout/auth-layout";

export default function NotFound() {
  return (
    <AuthLayout>
      <div className="card grid gap-4" data-not-found>
        <SearchX aria-hidden="true" size={28} className="text-text-muted" />
        <h1 className="m-0 text-h1 font-bold">페이지를 찾을 수 없습니다</h1>
        <p className="m-0 text-text-muted">요청하신 페이지를 찾을 수 없습니다. 주소를 다시 확인해 주세요.</p>
        <Link href="/dashboard" className="btn">
          <ArrowLeft aria-hidden="true" size={18} />
          대시보드로 돌아가기
        </Link>
      </div>
    </AuthLayout>
  );
}
