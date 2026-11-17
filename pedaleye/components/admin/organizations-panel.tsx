"use client";

import { Building2, Car, UserCog } from "lucide-react";
import { useCallback, useState } from "react";

import { EmptyState } from "@/components/page/empty-state";
import { ORGANIZATION_TYPE_LABELS } from "@/lib/organizations/labels";
import type { OrganizationSummary } from "@/lib/organizations/operations";

import { InviteOrgAdminDialog, OrganizationFormDialog } from "./organization-dialogs";

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE ?? "Asia/Seoul",
});

/** 조직 목록 + 생성·수정·관리자 초대. 저장 결과는 화면 낭독기에도 알린다. */
export function OrganizationsPanel({ organizations }: { organizations: OrganizationSummary[] }) {
  const [notice, setNotice] = useState<string | null>(null);
  const onSaved = useCallback((message: string) => setNotice(message), []);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-text-muted">조직 {organizations.length}곳</p>
        <OrganizationFormDialog onSaved={onSaved} />
      </div>
      <div aria-live="polite" role="status">
        {notice ? (
          <p className="m-0 rounded-md border border-border-strong bg-good-bg px-4 py-3 font-semibold text-good">{notice}</p>
        ) : null}
      </div>

      {organizations.length === 0 ? (
        <EmptyState icon={Building2} title="등록된 조직이 없습니다.">
          신규 지자체 또는 플릿 조직을 생성하여 운영을 시작하세요.
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {organizations.map((org) => (
            <li key={org.id} className="grid gap-3 rounded-md border border-border bg-bg-base p-4">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <strong className="text-h2">{org.name}</strong>
                <span className="rounded-md border border-border-strong px-2 text-caption font-medium">
                  {ORGANIZATION_TYPE_LABELS[org.type]}
                </span>
              </div>
              <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-text-muted">
                <div className="flex items-center gap-1">
                  <Car aria-hidden="true" size={16} />
                  <dt>차량</dt>
                  <dd className="m-0 font-semibold text-text-main tabular-nums">{org.vehicleCount}대</dd>
                </div>
                <div className="flex items-center gap-1">
                  <UserCog aria-hidden="true" size={16} />
                  <dt>조직 관리자</dt>
                  <dd className="m-0 font-semibold text-text-main tabular-nums">{org.adminCount}명</dd>
                </div>
                <div className="flex items-center gap-1">
                  <dt>생성일</dt>
                  <dd className="m-0">
                    <time dateTime={org.createdAt}>{dateFormat.format(new Date(org.createdAt))}</time>
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <InviteOrgAdminDialog orgId={org.id} orgName={org.name} />
                <OrganizationFormDialog organization={{ id: org.id, name: org.name, type: org.type }} onSaved={onSaved} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
