import type { Metadata } from "next";

import { LogoutButton } from "@/app/logout-button";
import { requireUserForPath } from "@/lib/auth/get-current-user";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "사고 이벤트 | 페달아이" };

const TRIGGER_LABELS = {
  shock: "충격 감지",
  sudden_accel: "급가속 감지",
  manual: "수동 백업",
  periodic: "정기 기록",
} as const;

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE ?? "Asia/Seoul",
});

// 임시 화면: 이벤트 목록 기능 작업이 실제 화면으로 교체한다.
export default async function EventsPage() {
  const user = await requireUserForPath("/events");
  const supabase = await createClient();
  const { data: sessions, error } = await supabase
    .from("event_sessions")
    .select("id, trigger_type, start_time, record_count, integrity_verified")
    .order("start_time", { ascending: false });

  if (error) throw new Error(`이벤트 목록 조회 실패 (${error.code})`);

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>사고 이벤트</h1>
          <p className="muted" style={{ margin: 0 }}>
            {user.name} · {ROLE_LABELS[user.role]}
          </p>
        </div>
        <LogoutButton />
      </header>

      <section className="card" aria-labelledby="events-heading" style={{ display: "grid", gap: "var(--space-4)" }}>
        <h2 id="events-heading">이벤트 세션</h2>
        {sessions.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            아직 업로드된 사고 이벤트가 없습니다. 모바일 앱에서 이벤트를 백업하면 여기에 표시됩니다.
          </p>
        ) : (
          <ul className="list">
            {sessions.map((session) => (
              <li key={session.id} className="list-item">
                <strong>{TRIGGER_LABELS[session.trigger_type]}</strong>{" "}
                <time className="caption" dateTime={session.start_time}>
                  {dateFormat.format(new Date(session.start_time))}
                </time>
                <div className="muted">
                  레코드 {session.record_count.toLocaleString("ko-KR")}개 · 무결성{" "}
                  {session.integrity_verified ? "검증 완료" : "검증 전"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
