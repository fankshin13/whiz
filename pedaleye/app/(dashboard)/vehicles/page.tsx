import { Car, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { InviteDriverModal } from "@/components/fleet/invite-driver-modal";
import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { PendingAction } from "@/components/page/pending-action";
import { Section } from "@/components/page/section";
import { requireUserForPath } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "차량 관리 | 페달아이" };

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE ?? "Asia/Seoul",
});

export default async function VehiclesPage() {
  await requireUserForPath("/vehicles");
  const supabase = await createClient();

  const [vehiclesResult, invitationsResult] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, plate_number, model_name, model_year, driver:users!vehicles_assigned_user_id_fkey(name)")
      .order("plate_number"),
    supabase
      .from("invitations")
      .select("vehicle_id, invitee_name, expires_at")
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString()),
  ]);
  if (vehiclesResult.error) throw new Error(`차량 목록 조회 실패 (${vehiclesResult.error.code})`);
  if (invitationsResult.error) throw new Error(`초대 목록 조회 실패 (${invitationsResult.error.code})`);

  const pendingByVehicle = new Map(invitationsResult.data.map((inv) => [inv.vehicle_id, inv]));
  const vehicles = vehiclesResult.data;

  return (
    <>
      <PageHeader
        title="차량 관리"
        description="조직에 등록된 차량과 배정 운전자를 관리합니다. 미배정 차량에는 1회용 초대 링크로 운전자를 연결합니다."
        action={
          <PendingAction id="new-vehicle">
            <Plus aria-hidden="true" size={18} />
            신규 차량 등록
          </PendingAction>
        }
      />
      <Section id="vehicle-list-heading" title="차량 및 운전자 배정 현황">
        {vehicles.length === 0 ? (
          <EmptyState icon={Car} title="등록된 차량이 없습니다.">
            차량이 등록되면 이곳에서 운전자를 초대할 수 있습니다.
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
                      className="inline-flex min-h-(--size-touch) items-center gap-2 font-bold text-text-main"
                    >
                      {vehicle.plate_number}
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
