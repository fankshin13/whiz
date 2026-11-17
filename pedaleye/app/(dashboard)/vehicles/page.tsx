import { Car, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { InviteDriverModal } from "@/components/fleet/invite-driver-modal";
import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { Section } from "@/components/page/section";
import { VehicleFormDialog } from "@/components/vehicles/vehicle-dialogs";
import { requireUserForPath } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "차량 관리 | 페달아이" };

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE ?? "Asia/Seoul",
});

const NOTICES: Record<string, string> = { created: "차량이 성공적으로 등록되었습니다." };

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const user = await requireUserForPath("/vehicles");
  const { notice } = await searchParams;
  const supabase = await createClient();

  const [vehiclesResult, invitationsResult, orgsResult] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, plate_number, model_name, model_year, driver:users!vehicles_assigned_user_id_fkey(name)")
      .order("plate_number"),
    supabase
      .from("invitations")
      .select("vehicle_id, invitee_name, expires_at")
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()),
    // 슈퍼 관리자는 등록할 조직을 고르고, 조직 관리자는 자기 조직(RLS 로 하나만 보임)
    supabase.from("organizations").select("id, name").order("name"),
  ]);
  if (orgsResult.error) throw new Error(`조직 조회 실패 (${orgsResult.error.code})`);
  const createDialog = (label?: string) =>
    user.role === "super_admin" ? (
      <VehicleFormDialog organizations={orgsResult.data} label={label} />
    ) : (
      <VehicleFormDialog fixedOrgName={orgsResult.data[0]?.name} label={label} />
    );
  if (vehiclesResult.error) throw new Error(`차량 목록 조회 실패 (${vehiclesResult.error.code})`);
  if (invitationsResult.error) throw new Error(`초대 목록 조회 실패 (${invitationsResult.error.code})`);

  const pendingByVehicle = new Map(invitationsResult.data.map((inv) => [inv.vehicle_id, inv]));
  const vehicles = vehiclesResult.data;

  return (
    <>
      <PageHeader
        title="차량 관리"
        description="조직에 등록된 차량과 배정 운전자를 관리합니다. 미배정 차량에는 1회용 초대 링크로 운전자를 연결합니다."
        action={createDialog()}
      />
      {notice && NOTICES[notice] ? (
        <p role="status" className="m-0 flex items-center gap-2 rounded-md border border-border-strong bg-good-bg px-4 py-3 font-semibold text-good">
          <CheckCircle2 aria-hidden="true" size={20} />
          {NOTICES[notice]}
        </p>
      ) : null}
      <Section id="vehicle-list-heading" title="차량 및 운전자 배정 현황">
        {vehicles.length === 0 ? (
          <EmptyState icon={Car} title="등록된 차량이 없습니다.">
            <p className="m-0">신규 차량을 등록하고 페달아이 단말을 연결하여 안전 관제를 시작하세요.</p>
            <div className="mt-4 flex justify-center">{createDialog("첫 차량 등록하기")}</div>
          </EmptyState>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {vehicles.map((vehicle) => {
              const pending = pendingByVehicle.get(vehicle.id);
              return (
                <li
                  key={vehicle.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-bg-base px-4 py-3"
                >
                  <div className="grid min-w-0 gap-0.5">
                    <Link
                      href={`/vehicles/${vehicle.id}`}
                      className="inline-flex min-h-(--size-touch) flex-wrap items-center gap-x-2 font-bold text-text-main"
                    >
                      <span className="whitespace-nowrap">{vehicle.plate_number}</span>
                      <span className="font-normal text-text-muted">
                        {vehicle.model_name}
                        {vehicle.model_year ? ` (${vehicle.model_year}년식)` : ""}
                      </span>
                    </Link>
                    <span className="text-text-muted">
                      {vehicle.driver
                        ? `배정 운전자: ${vehicle.driver.name}`
                        : pending
                          ? `초대 대기 중: ${pending.invitee_name} (만료 ${dateFormat.format(new Date(pending.expires_at))})`
                          : "배정 운전자 없음"}
                    </span>
                  </div>
                  {!vehicle.driver && !pending ? (
                    <InviteDriverModal vehicleId={vehicle.id} plateNumber={vehicle.plate_number} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
