import { ArrowLeft, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { SESSION_NOT_AVAILABLE } from "@/lib/forensics/session-forensics";

export default function EventForbidden() {
  return (
    <div className="card grid max-w-xl gap-4">
      <ShieldAlert aria-hidden="true" size={28} className="text-brake" />
      <h1 className="m-0 text-h1 font-bold">접근 권한 없음</h1>
      <p className="m-0 text-text-muted">{SESSION_NOT_AVAILABLE}</p>
      <Link href="/events" className="btn justify-self-start">
        <ArrowLeft aria-hidden="true" size={18} />
        사고 이벤트 목록으로
      </Link>
    </div>
  );
}
