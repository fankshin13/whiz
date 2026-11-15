import { Building2, Plus } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { PendingAction } from "@/components/page/pending-action";
import { Section } from "@/components/page/section";
import { requireUserForPath } from "@/lib/auth/get-current-user";

export const metadata: Metadata = { title: "조직 관리 | 페달아이" };

export default async function OrganizationsPage() {
  await requireUserForPath("/admin/organizations");

  return (
    <>
      <PageHeader
        title="조직 관리"
        description="지자체(B2G)와 운수사(B2B) 테넌트 조직과 관리자 계정을 관리합니다."
        action={
          <PendingAction id="new-org">
            <Plus aria-hidden="true" size={18} />
            신규 지자체/플릿 조직 생성
          </PendingAction>
        }
      />
      <Section id="org-list-heading" title="테넌트 조직">
        <EmptyState icon={Building2} title="조직 목록 화면을 준비 중입니다.">
          조직 이름, 유형(지자체·플릿·일반), 소속 차량 수와 관리자 초대 현황이 표시됩니다.
        </EmptyState>
      </Section>
    </>
  );
}
