import { CheckCircle2, ChevronLeft, ChevronRight, MailX, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { RetryAlert } from "@/components/page/retry-alert";
import { Section } from "@/components/page/section";
import { ReissueInvitationDialog, RevokeInvitationDialog } from "@/components/invitations/invitation-dialogs";
import { DeactivateUserDialog, ReactivateUserDialog } from "@/components/users/user-dialogs";
import { ROLE_LABELS } from "@/lib/audit/labels";
import { requireUserForPath, type CurrentUser } from "@/lib/auth/get-current-user";
import {
  INVITATION_STATUS_LABELS,
  invitationFilterSchema,
  listInvitations,
  type InvitationFilter,
  type InvitationStatus,
} from "@/lib/invitations/management";
import { createClient } from "@/lib/supabase/server";
import { listUsers, userFilterSchema, type UserFilter, type UserListItem } from "@/lib/users/operations";

export const metadata: Metadata = { title: "사용자 관리 | 페달아이" };

const dateTime = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE ?? "Asia/Seoul",
});
const date = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE ?? "Asia/Seoul" });

type RawParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function toQuery(filter: UserFilter, page?: number): string {
  const params = new URLSearchParams();
  for (const key of ["org", "role", "status", "q"] as const) {
    const value = filter[key];
    if (value) params.set(key, value);
  }
  if (page && page > 1) params.set("page", String(page));
  return params.toString();
}

const NOTICES: Record<string, string> = {
  deactivated: "사용자 계정이 비활성화되었습니다.",
  reactivated: "계정이 정상적으로 재활성화되었습니다.",
  demoted: "조직 관리자를 운전자로 변경했습니다.",
  invitation_revoked: "초대 링크가 정상적으로 취소되었습니다.",
};

export default async function UsersPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  // 슈퍼 관리자·조직 관리자 전용(라우트 맵). 운전자·조사관은 403
  const user = await requireUserForPath("/users");
  const raw = await searchParams;
  const filter = userFilterSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, first(v)])));
  const notice = first(raw.notice);
  const unassigned = first(raw.unassigned)?.slice(0, 200);
  const supabase = await createClient();
  const orgs = (await supabase.from("organizations").select("id, name").order("name")).data ?? [];
  const isSuper = user.role === "super_admin";
  const tab = first(raw.tab) === "invitations" ? "invitations" : "users";
  const invitationFilter = invitationFilterSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, first(v)])));

  return (
    <>
      <PageHeader
        title="사용자 관리"
        description={
          isSuper
            ? "모든 조직의 사용자를 조회하고 계정을 비활성화·재활성화합니다. 계정은 삭제하지 않아 사고 기록과 감사 기록이 보존됩니다."
            : `${orgs[0]?.name ?? "우리 조직"}의 운전자·사고조사관 계정을 관리합니다. 계정은 삭제하지 않고 비활성화합니다.`
        }
      />
      {notice && NOTICES[notice] ? (
        <p role="status" className="m-0 flex items-start gap-2 rounded-md border border-border-strong bg-good-bg px-4 py-3 font-semibold text-good">
          <CheckCircle2 aria-hidden="true" size={20} className="mt-0.5 shrink-0" />
          <span>
            {NOTICES[notice]}
            {unassigned ? ` 차량 ${unassigned} 배정을 해제했습니다.` : ""}
          </span>
        </p>
      ) : null}
      <nav aria-label="사용자 관리 보기" className="flex flex-wrap gap-2">
        <Link href="/users" aria-current={tab === "users" ? "page" : undefined} className={tab === "users" ? "btn" : "btn btn-secondary"}>
          사용자
        </Link>
        <Link
          href="/users?tab=invitations"
          aria-current={tab === "invitations" ? "page" : undefined}
          className={tab === "invitations" ? "btn" : "btn btn-secondary"}
        >
          초대
        </Link>
      </nav>
      {tab === "invitations" ? (
        <Section id="invitation-list-heading" title="초대 내역">
          <Suspense key={`inv-${invitationFilter.istatus ?? ""}-${invitationFilter.ipage}`} fallback={<UsersSkeleton />}>
            <InvitationList user={user} filter={invitationFilter} />
          </Suspense>
        </Section>
      ) : (
        <>
          <Section id="user-filter-heading" title="조회 조건">
            <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="사용자 조회 조건">
              {isSuper ? (
                <Field label="조직" htmlFor="user-org">
                  <select id="user-org" name="org" className="input" defaultValue={filter.org ?? ""}>
                    <option value="">전체 조직</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field label="역할" htmlFor="user-role">
                <select id="user-role" name="role" className="input" defaultValue={filter.role ?? ""}>
                  <option value="">전체</option>
                  {(isSuper ? ["super_admin", "org_admin", "driver", "investigator"] : ["driver", "investigator"]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="상태" htmlFor="user-status">
                <select id="user-status" name="status" className="input" defaultValue={filter.status ?? ""}>
                  <option value="">전체</option>
                  <option value="active">활성</option>
                  <option value="inactive">비활성</option>
                </select>
              </Field>
              <Field label="검색" htmlFor="user-q">
                <input id="user-q" name="q" className="input" maxLength={50} placeholder="이름, 이메일, 차량 번호" defaultValue={filter.q ?? ""} />
              </Field>
              <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
                <button type="submit" className="btn">
                  조회
                </button>
                <Link href="/users" className="btn btn-secondary">
                  필터 초기화
                </Link>
              </div>
            </form>
          </Section>
          <Section id="user-list-heading" title="사용자 목록">
            <Suspense key={toQuery(filter, filter.page)} fallback={<UsersSkeleton />}>
              <UserList user={user} filter={filter} />
            </Suspense>
          </Section>
        </>
      )}
    </>
  );
}

const INVITATION_FILTERS = [
  { key: "", label: "전체" },
  { key: "PENDING", label: "대기" },
  { key: "EXPIRED", label: "만료" },
  { key: "ACCEPTED", label: "수락 완료" },
  { key: "REVOKED", label: "취소됨" },
] as const;

const STATUS_BADGE: Record<InvitationStatus, string> = {
  PENDING: "border-accel bg-accel-bg text-accel",
  EXPIRED: "border-border-strong bg-bg-panel text-text-muted",
  ACCEPTED: "border-good bg-good-bg text-good",
  REVOKED: "border-critical bg-critical-bg text-critical",
};

function invitationQuery(filter: InvitationFilter, page?: number): string {
  const params = new URLSearchParams({ tab: "invitations" });
  if (filter.istatus) params.set("istatus", filter.istatus);
  if (page && page > 1) params.set("ipage", String(page));
  return params.toString();
}

async function InvitationList({ user, filter }: { user: CurrentUser; filter: InvitationFilter }) {
  let result: Awaited<ReturnType<typeof listInvitations>>;
  try {
    result = await listInvitations(await createClient(), user, filter);
  } catch (error) {
    console.error("invitations load failed", { message: error instanceof Error ? error.message : "unknown" });
    return <RetryAlert message="초대 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." />;
  }
  const { items, total, page, totalPages } = result;
  const returnTo = `/users?${invitationQuery(filter, page)}`;

  return (
    <div className="grid gap-4">
      <nav aria-label="초대 상태 필터" className="flex flex-wrap gap-2">
        {INVITATION_FILTERS.map((f) => {
          const active = (filter.istatus ?? "") === f.key;
          return (
            <Link
              key={f.key || "all"}
              href={`/users?${invitationQuery({ ...filter, istatus: (f.key || undefined) as InvitationFilter["istatus"], ipage: 1 })}`}
              aria-current={active ? "page" : undefined}
              className={active ? "btn" : "btn btn-secondary"}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>
      {items.length === 0 ? (
        <EmptyState icon={MailX} title="등록된 초대 내역이 없습니다.">
          <div className="mt-2 flex justify-center">
            <Link href="/vehicles" className="btn">
              새 운전자 초대
            </Link>
          </div>
        </EmptyState>
      ) : (
        <>
          <p className="m-0 text-text-muted">
            총 <strong className="tabular-nums text-text-main">{total.toLocaleString("ko-KR")}</strong>건
          </p>
          <ul className="m-0 grid list-none gap-3 p-0">
            {items.map((inv) => (
              <li key={inv.id} className="grid gap-3 rounded-md border border-border bg-bg-base p-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong className="text-h2">{inv.inviteeName}</strong>
                  <span className="rounded-md border border-border-strong px-2 text-caption font-medium">{ROLE_LABELS[inv.role]}</span>
                  <span className={`rounded-md border px-2 text-caption font-semibold ${STATUS_BADGE[inv.status]}`}>{INVITATION_STATUS_LABELS[inv.status]}</span>
                </div>
                <dl className="m-0 grid gap-x-6 gap-y-1 text-text-muted sm:grid-cols-2">
                  <Item label="이메일">
                    <span className="break-all">{inv.email}</span>
                  </Item>
                  {user.role === "super_admin" ? <Item label="조직">{inv.orgName ?? "-"}</Item> : null}
                  <Item label="배정 차량">
                    {inv.vehicleId && inv.vehiclePlate ? (
                      <Link href={`/vehicles/${inv.vehicleId}`} className="whitespace-nowrap font-semibold text-text-main underline">
                        {inv.vehiclePlate}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </Item>
                  <Item label="만든 사람">{inv.createdByName ?? "-"}</Item>
                  <Item label="발급">
                    <time dateTime={inv.createdAt}>{dateTime.format(new Date(inv.createdAt))}</time>
                  </Item>
                  <Item label={inv.status === "REVOKED" ? "취소" : inv.status === "ACCEPTED" ? "수락" : "만료"}>
                    {(() => {
                      const at = inv.status === "REVOKED" ? inv.revokedAt : inv.status === "ACCEPTED" ? inv.usedAt : inv.expiresAt;
                      return at ? <time dateTime={at}>{dateTime.format(new Date(at))}</time> : "-";
                    })()}
                  </Item>
                </dl>
                {inv.status === "PENDING" || inv.status === "EXPIRED" ? (
                  <div className="flex flex-wrap gap-2">
                    <ReissueInvitationDialog invitation={{ id: inv.id, inviteeName: inv.inviteeName, email: inv.email, vehiclePlate: inv.vehiclePlate }} />
                    {inv.status === "PENDING" ? (
                      <RevokeInvitationDialog
                        invitation={{ id: inv.id, inviteeName: inv.inviteeName, email: inv.email, vehiclePlate: inv.vehiclePlate }}
                        returnTo={returnTo}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {totalPages > 1 ? (
            <nav aria-label="초대 페이지 이동" className="flex flex-wrap items-center justify-center gap-3">
              {page > 1 ? (
                <Link href={`/users?${invitationQuery(filter, page - 1)}`} className="btn btn-secondary" rel="prev">
                  <ChevronLeft aria-hidden="true" size={18} />
                  이전
                </Link>
              ) : null}
              <span className="tabular-nums text-text-muted">
                {page} / {totalPages}
              </span>
              {page < totalPages ? (
                <Link href={`/users?${invitationQuery(filter, page + 1)}`} className="btn btn-secondary" rel="next">
                  다음
                  <ChevronRight aria-hidden="true" size={18} />
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={htmlFor} className="font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}

async function UserList({ user, filter }: { user: CurrentUser; filter: UserFilter }) {
  let result: Awaited<ReturnType<typeof listUsers>>;
  try {
    result = await listUsers(await createClient(), user, filter);
  } catch (error) {
    console.error("users page load failed", { message: error instanceof Error ? error.message : "unknown" });
    return <RetryAlert message="사용자 목록을 불러오지 못했습니다." />;
  }
  const { users, total, page, totalPages } = result;
  const returnQuery = toQuery(filter, page);

  if (users.length === 0) {
    return (
      <EmptyState icon={Users} title="조건에 일치하는 사용자가 없습니다.">
        <div className="mt-2 flex justify-center">
          <Link href="/users" className="btn btn-secondary">
            필터 초기화
          </Link>
        </div>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="m-0 text-text-muted">
        총 <strong className="tabular-nums text-text-main">{total.toLocaleString("ko-KR")}</strong>명
      </p>
      <ul className="m-0 grid list-none gap-3 p-0">
        {users.map((u) => (
          <UserRow key={u.id} item={u} currentUserId={user.id} showOrg={user.role === "super_admin"} returnQuery={returnQuery} />
        ))}
      </ul>
      {totalPages > 1 ? (
        <nav aria-label="페이지 이동" className="flex flex-wrap items-center justify-center gap-3">
          {page > 1 ? (
            <Link href={`/users?${toQuery(filter, page - 1)}`} className="btn btn-secondary" rel="prev">
              <ChevronLeft aria-hidden="true" size={18} />
              이전
            </Link>
          ) : null}
          <span className="tabular-nums text-text-muted">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/users?${toQuery(filter, page + 1)}`} className="btn btn-secondary" rel="next">
              다음
              <ChevronRight aria-hidden="true" size={18} />
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function UserRow({ item, currentUserId, showOrg, returnQuery }: { item: UserListItem; currentUserId: string; showOrg: boolean; returnQuery: string }) {
  const managed = { id: item.id, name: item.name, email: item.email, role: item.role, vehicles: item.vehicles.map((v) => v.plateNumber) };
  return (
    <li className={`grid gap-3 rounded-md border p-4 ${item.isActive ? "border-border bg-bg-base" : "border-dashed border-border-strong bg-bg-panel"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong className="text-h2">{item.name}</strong>
        <span className="rounded-md border border-border-strong px-2 text-caption font-medium">{ROLE_LABELS[item.role]}</span>
        {item.isActive ? (
          <span className="rounded-md border border-good bg-good-bg px-2 text-caption font-semibold text-good">활성</span>
        ) : (
          <span className="rounded-md border border-critical bg-critical-bg px-2 text-caption font-semibold text-critical">비활성</span>
        )}
        {item.id === currentUserId ? <span className="text-caption text-text-muted">(본인)</span> : null}
      </div>
      <dl className="m-0 grid gap-x-6 gap-y-1 text-text-muted sm:grid-cols-2">
        <Item label="이메일">
          <span className="break-all">{item.email}</span>
        </Item>
        {showOrg ? <Item label="소속">{item.orgName ?? "-"}</Item> : null}
        <Item label="배정 차량">
          {item.vehicles.length
            ? item.vehicles.map((v, i) => (
                <span key={v.id}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/vehicles/${v.id}`} className="whitespace-nowrap font-semibold text-text-main underline">
                    {v.plateNumber}
                  </Link>
                </span>
              ))
            : "-"}
        </Item>
        <Item label="가입일">
          <time dateTime={item.createdAt}>{date.format(new Date(item.createdAt))}</time>
        </Item>
        <Item label="최근 로그인">
          {item.lastSignInAt ? <time dateTime={item.lastSignInAt}>{dateTime.format(new Date(item.lastSignInAt))}</time> : "기록 없음"}
        </Item>
        {item.deactivatedAt ? (
          <Item label="비활성화">
            <time dateTime={item.deactivatedAt}>{dateTime.format(new Date(item.deactivatedAt))}</time>
          </Item>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        {item.isActive ? (
          <DeactivateUserDialog user={managed} isSelf={item.id === currentUserId} returnQuery={returnQuery} />
        ) : (
          <ReactivateUserDialog user={managed} returnQuery={returnQuery} />
        )}
      </div>
    </li>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-2">
      <dt>{label}</dt>
      <dd className="m-0 min-w-0 text-text-main">{children}</dd>
    </div>
  );
}

function UsersSkeleton() {
  return (
    <div className="grid gap-3" role="status" aria-label="사용자 목록을 불러오는 중">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="grid gap-2 rounded-md border border-border bg-bg-base p-4">
          <div className="h-5 w-1/3 rounded-md bg-border motion-safe:animate-pulse" />
          <div className="h-4 w-3/4 rounded-md bg-border motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}
