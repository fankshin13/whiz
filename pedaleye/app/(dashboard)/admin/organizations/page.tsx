import type { Metadata } from "next";
import { Suspense } from "react";

import { OrganizationsPanel } from "@/components/admin/organizations-panel";
import { PageHeader } from "@/components/page/page-header";
import { RetryAlert } from "@/components/page/retry-alert";
import { Section } from "@/components/page/section";
import { requireUserForPath, type CurrentUser } from "@/lib/auth/get-current-user";
import { listOrganizationsWithStats, type OrganizationSummary } from "@/lib/organizations/operations";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "조직 관리 | 페달아이" };

export default async function OrganizationsPage() {
  // 슈퍼 관리자 전용(라우트 맵). 다른 역할은 403
  const user = await requireUserForPath("/admin/organizations");

  return (
    <>
      <PageHeader
        title="조직 및 테넌트 관리"
        description="지자체(B2G)와 운수사(플릿) 조직을 만들고, 조직을 운영할 관리자를 1회용 초대 링크로 연결합니다."
      />
      <Section id="org-list-heading" title="테넌트 조직">
        <Suspense fallback={<OrganizationsSkeleton />}>
          <OrganizationsList user={user} />
        </Suspense>
      </Section>
    </>
  );
}

async function OrganizationsList({ user }: { user: CurrentUser }) {
  let organizations: OrganizationSummary[];
  try {
    organizations = await listOrganizationsWithStats(await createClient(), user);
  } catch (error) {
    console.error("organizations page load failed", { message: error instanceof Error ? error.message : "unknown" });
    return <RetryAlert message="조직 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." />;
  }
  return <OrganizationsPanel organizations={organizations} />;
}

function OrganizationsSkeleton() {
  return (
    <div className="grid gap-3" role="status" aria-label="조직 목록을 불러오는 중">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="grid gap-2 rounded-md border border-border bg-bg-base p-4">
          <div className="h-5 w-40 rounded-md bg-border motion-safe:animate-pulse" />
          <div className="h-4 w-64 max-w-full rounded-md bg-border motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}
