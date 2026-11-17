import { AlertCircle, CheckCircle2, Cpu, SlidersHorizontal, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { InviteDriverModal } from "@/components/fleet/invite-driver-modal";
import { PageHeader } from "@/components/page/page-header";
import { Section } from "@/components/page/section";
import { UnassignDriverDialog, VehicleFormDialog } from "@/components/vehicles/vehicle-dialogs";
import { requireUserForPath } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "차량 상세 | 페달아이" };

const NOTICES: Record<string, string> = {
  updated: "차량 정보가 변경되었습니다.",
  unassigned: "운전자 배정을 해제했습니다. 이제 새 운전자를 초대할 수 있습니다.",
};

const dateTime = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE ?? "Asia/Seoul",
});

export default async function VehicleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const { notice } = await searchParams;
  const user = await requireUserForPath(`/vehicles/${id}`);
  const canManage = user.role === "super_admin" || user.role === "org_admin";

  const supabase = await createClient();
  // RLS: 슈퍼 관리자 전체, 조직 관리자·조사관 자기 조직, 운전자 본인 배정 차량
  const { data: vehicle, error } = /^[0-9a-f-]{36}$/i.test(id)
    ? await supabase
        .from("vehicles")
        .select(
          "id, plate_number, model_name, model_year, vin_masked, org:organizations(name), driver:users!vehicles_assigned_user_id_fkey(name, email), device:devices(id, serial_number, firmware_version, last_synced_at, accel_calib_min, accel_calib_max, brake_calib_min, brake_calib_max)",
        )
        .eq("id", id)
        .maybeSingle()
    : { data: null, error: null };
  if (error) throw new Error(`차량 조회 실패 (${error.code})`);

  if (!vehicle) {
    return (
      <div role="alert" className="card grid gap-4">
        <AlertCircle aria-hidden="true" size={28} className="text-brake" />
        <h1 className="m-0 text-h1 font-bold">차량 정보를 찾을 수 없거나 접근 권한이 없습니다.</h1>
        <Link href={canManage ? "/vehicles" : "/dashboard"} className="btn justify-self-start">
          {canManage ? "차량 목록으로 돌아가기" : "대시보드로 돌아가기"}
        </Link>
      </div>
    );
  }

  const device = Array.isArray(vehicle.device) ? vehicle.device[0] : vehicle.device;
  const factoryCalibration =
    device &&
    device.accel_calib_min === 0 &&
    device.accel_calib_max === 4095 &&
    device.brake_calib_min === 0 &&
    device.brake_calib_max === 4095;
  const pendingInvite = canManage && !vehicle.driver
    ? (
        await supabase
          .from("invitations")
          .select("invitee_name, expires_at")
          .eq("vehicle_id", vehicle.id)
          .is("used_at", null)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle()
      ).data
    : null;

  return (
    <>
      <PageHeader
        title={vehicle.plate_number}
        description={`${vehicle.model_name}${vehicle.model_year ? ` (${vehicle.model_year}년식)` : ""} · ${vehicle.org?.name ?? ""}`}
        action={
          canManage ? (
            <VehicleFormDialog
              vehicle={{
                id: vehicle.id,
                plateNumber: vehicle.plate_number,
                modelName: vehicle.model_name,
                modelYear: vehicle.model_year,
                vinMasked: vehicle.vin_masked,
                orgName: vehicle.org?.name ?? "",
              }}
            />
          ) : null
        }
      />
      {notice && NOTICES[notice] ? (
        <p role="status" className="m-0 flex items-center gap-2 rounded-md border border-border-strong bg-good-bg px-4 py-3 font-semibold text-good">
          <CheckCircle2 aria-hidden="true" size={20} />
          {NOTICES[notice]}
        </p>
      ) : null}

      <Section id="vehicle-device-heading" title="장착 단말과 페달 보정">
        {device ? (
          <div className="grid gap-4">
            <dl className="m-0 grid gap-3 sm:grid-cols-3">
              <div className="grid gap-0.5">
                <dt className="text-caption text-text-muted">단말 일련번호</dt>
                <dd className="m-0 font-semibold">{device.serial_number}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-caption text-text-muted">펌웨어</dt>
                <dd className="m-0 font-semibold">{device.firmware_version}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-caption text-text-muted">마지막 동기화</dt>
                <dd className="m-0 font-semibold">{device.last_synced_at ? dateTime.format(new Date(device.last_synced_at)) : "아직 없음"}</dd>
              </div>
            </dl>
            <p className="m-0 text-text-muted">{factoryCalibration ? "아직 보정 전입니다(공장 기본값)." : "보정값이 저장되어 있습니다."}</p>
            <Link href={`/devices/calibrate?deviceId=${device.id}`} className="btn justify-self-start border-accel bg-accel">
              <SlidersHorizontal aria-hidden="true" size={18} />
              페달 캘리브레이션 시작
            </Link>
            {canManage ? (
              <Link href="/devices" className="inline-flex min-h-11 items-center justify-self-start font-semibold underline">
                단말 교체·해제는 단말 관리에서
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="m-0 flex items-center gap-2 font-semibold text-text-muted">
              <Cpu aria-hidden="true" size={20} />
              연결된 페달아이 단말이 없습니다.
            </p>
            <button type="button" className="btn btn-secondary justify-self-start" disabled aria-describedby="no-device-note">
              <SlidersHorizontal aria-hidden="true" size={18} />
              보정 불가
            </button>
            <span id="no-device-note" className="text-caption text-text-muted">
              단말을 이 차량에 장착한 뒤 보정할 수 있습니다.
            </span>
            {canManage ? (
              <Link href="/devices?filter=inventory" className="btn justify-self-start">
                <Cpu aria-hidden="true" size={18} />
                단말 관리에서 장착하기
              </Link>
            ) : null}
          </div>
        )}
      </Section>

      <Section id="vehicle-driver-heading" title="배정 운전자">
        {vehicle.driver ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-0.5">
              <span className="flex items-center gap-2 font-semibold">
                <UserRound aria-hidden="true" size={18} />
                {vehicle.driver.name}
              </span>
              <span className="break-all text-text-muted">{vehicle.driver.email}</span>
            </div>
            {canManage ? <UnassignDriverDialog vehicleId={vehicle.id} driverName={vehicle.driver.name} /> : null}
          </div>
        ) : pendingInvite ? (
          <p className="m-0 text-text-muted">
            초대 대기 중: {pendingInvite.invitee_name} (만료 {dateTime.format(new Date(pendingInvite.expires_at))})
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-text-muted">배정된 운전자가 없습니다.</p>
            {canManage ? <InviteDriverModal vehicleId={vehicle.id} plateNumber={vehicle.plate_number} /> : null}
          </div>
        )}
      </Section>
    </>
  );
}
