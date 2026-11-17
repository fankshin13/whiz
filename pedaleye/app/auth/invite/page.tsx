import { AlertCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { InviteAcceptForm } from "@/components/fleet/invite-accept-form";
import { lookupInvitation, type InvitationFailure } from "@/lib/invitations/operations";
import { createAdminClient } from "@/lib/server/supabase-admin";

export const metadata: Metadata = {
  title: "운전자 온보딩 | 페달아이",
  // 토큰이 담긴 주소가 외부 사이트로 새지 않도록
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

const FAILURE_MESSAGES: Record<InvitationFailure, string> = {
  NOT_FOUND:
    "유효하지 않거나 이미 사용이 완료된 초대 링크입니다. 소속 운수사 또는 지자체 관리자에게 링크 재발급을 요청해주세요.",
  ALREADY_USED:
    "유효하지 않거나 이미 사용이 완료된 초대 링크입니다. 소속 운수사 또는 지자체 관리자에게 링크 재발급을 요청해주세요.",
  EXPIRED: "초대 링크의 유효기간이 지났습니다. 소속 운수사 또는 지자체 관리자에게 링크 재발급을 요청해주세요.",
  REVOKED: "해당 초대 링크는 관리자에 의해 취소되었습니다. 관리자에게 새 링크 발급을 요청해 주세요.",
};

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const rawToken = typeof token === "string" ? token : "";
  const invitation = await lookupInvitation(createAdminClient(), rawToken);

  if (!invitation.valid) {
    return (
      <div className="card grid gap-4">
        <AlertCircle aria-hidden="true" size={32} className="text-brake" />
        <h1 className="m-0 text-h1 font-bold">초대 링크를 사용할 수 없습니다</h1>
        <p className="m-0" role="alert">
          {FAILURE_MESSAGES[invitation.reason]}
        </p>
        <Link href="/auth/login" className="btn btn-secondary">
          로그인 화면으로 이동
        </Link>
      </div>
    );
  }

  const isOrgAdmin = invitation.role === "org_admin";

  return (
    <>
      <div className="grid gap-2">
        <h1 className="m-0 text-h1 font-bold">{isOrgAdmin ? "페달아이 조직 관리자 등록" : "페달아이 운전자 온보딩"}</h1>
        <p className="m-0 text-text-muted">
          {isOrgAdmin
            ? `${invitation.inviteeName}님, 비밀번호를 설정하면 ${invitation.orgName}의 조직 관리자로 바로 시작할 수 있습니다.`
            : `${invitation.inviteeName}님, 비밀번호를 설정하면 배정 차량과 함께 바로 시작할 수 있습니다.`}
        </p>
      </div>
      <div className="card grid gap-6">
        <dl className="m-0 grid gap-3">
          <div className="grid gap-0.5">
            <dt className="text-caption font-medium text-text-muted">소속 조직</dt>
            <dd className="m-0 font-semibold">{invitation.orgName}</dd>
          </div>
          {isOrgAdmin ? (
            <div className="grid gap-0.5">
              <dt className="text-caption font-medium text-text-muted">역할</dt>
              <dd className="m-0 font-semibold">조직 관리자</dd>
            </div>
          ) : (
            <div className="grid gap-0.5">
              <dt className="text-caption font-medium text-text-muted">배정 차량</dt>
              <dd className="m-0 font-semibold">{invitation.vehiclePlate ?? "배정 예정 차량 없음"}</dd>
            </div>
          )}
          <div className="grid gap-0.5">
            <dt className="text-caption font-medium text-text-muted">로그인 이메일</dt>
            <dd className="m-0 font-semibold break-all">{invitation.email}</dd>
          </div>
        </dl>
        <InviteAcceptForm token={rawToken} />
      </div>
    </>
  );
}
