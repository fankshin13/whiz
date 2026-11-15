import { ShieldCheck, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { PendingAction } from "@/components/page/pending-action";
import { Section } from "@/components/page/section";
import { requireUserForPath } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "사고 이벤트 | 페달아이" };

const TRIGGER_LABELS = {
  shock: "충격 감지",
  sudden_accel: "급가감속 감지",
  manual: "수동 백업",
  periodic: "정기 기록",
} as const;

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE ?? "Asia/Seoul",
});

export default async function EventsPage() {
  await requireUserForPath("/events");
  const supabase = await createClient();
  const { data: sessions, error } = await supabase
    .from("event_sessions")
    .select("id, trigger_type, start_time, record_count, integrity_verified")
    .order("start_time", { ascending: false });
  if (error) throw new Error(`이벤트 목록 조회 실패 (${error.code})`);

  return (
    <>
      <PageHeader
        title="사고 이벤트"
        description="충격·급가속·수동 백업으로 동결된 사고 전후 60초 페달 기록입니다."
        action={
          <PendingAction id="upload-log">
            <Upload aria-hidden="true" size={18} />
            사고 로그 파일 업로드
          </PendingAction>
        }
      />

      <Section id="events-heading" title="이벤트 세션">
        {sessions.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="기록된 급가속 또는 충격 이벤트가 없습니다.">
            안전 운행 중입니다.
          </EmptyState>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {sessions.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/events/${session.id}`}
                  className="grid min-h-(--size-touch) gap-1 rounded-md border border-border bg-bg-base px-4 py-3 text-text-main no-underline hover:border-border-strong"
                >
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <strong>{TRIGGER_LABELS[session.trigger_type]}</strong>
                    <time className="text-caption font-medium text-text-muted" dateTime={session.start_time}>
                      {dateFormat.format(new Date(session.start_time))}
                    </time>
                  </span>
                  <span className="text-text-muted">
                    레코드 {session.record_count.toLocaleString("ko-KR")}개 · 무결성{" "}
                    {session.integrity_verified ? "검증 통과" : "검증 실패 또는 미검증"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
