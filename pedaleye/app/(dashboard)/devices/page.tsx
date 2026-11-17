import { AlertTriangle, CheckCircle2, Cpu, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DevicePublicKeyDialog, MountDeviceDialog, RegisterDeviceDialog, UnmountDeviceDialog, type MountTarget } from "@/components/devices/device-dialogs";
import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { RetryAlert } from "@/components/page/retry-alert";
import { Section } from "@/components/page/section";
import { requireUserForPath, type CurrentUser } from "@/lib/auth/get-current-user";
import { listDevices, maskPublicKey, SERIAL_PATTERN, type DeviceListItem } from "@/lib/devices/operations";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "단말 관리 | 페달아이" };

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE ?? "Asia/Seoul",
});

const FILTERS = [
  { key: "all", label: "전체" },
  { key: "mounted", label: "장착 완료" },
  { key: "inventory", label: "미장착 재고" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

type SearchParams = { filter?: string; notice?: string; device?: string; replaced?: string };

export default async function DevicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // 슈퍼 관리자·조직 관리자 전용(라우트 맵). 운전자·조사관은 403
  const user = await requireUserForPath("/devices");
  const params = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === params.filter) ? (params.filter as FilterKey) : "all";

  return (
    <>
      <PageHeader
        title="단말 관리"
        description={
          user.role === "super_admin"
            ? "입고된 단말을 조직 재고로 등록하고, 차량에 장착·교체·해제합니다."
            : "우리 조직 재고 단말을 차량에 장착·교체·해제합니다. 새 단말 입고는 페달아이 운영팀(슈퍼 관리자)이 등록합니다."
        }
      />
      <Section id="device-list-heading" title="단말 목록">
        <Suspense key={filter} fallback={<DevicesSkeleton />}>
          <DeviceList user={user} filter={filter} params={params} />
        </Suspense>
      </Section>
    </>
  );
}

async function DeviceList({ user, filter, params }: { user: CurrentUser; filter: FilterKey; params: SearchParams }) {
  const supabase = await createClient();
  let devices: DeviceListItem[];
  let vehicles: { id: string; plate_number: string; org_id: string }[];
  let organizations: { id: string; name: string }[] = [];
  try {
    const [deviceList, vehiclesResult, orgsResult] = await Promise.all([
      listDevices(supabase, user),
      supabase.from("vehicles").select("id, plate_number, org_id").order("plate_number"),
      user.role === "super_admin" ? supabase.from("organizations").select("id, name").order("name") : Promise.resolve(null),
    ]);
    if (vehiclesResult.error) throw new Error(`차량 조회 실패 (${vehiclesResult.error.code})`);
    if (orgsResult?.error) throw new Error(`조직 조회 실패 (${orgsResult.error.code})`);
    devices = deviceList;
    vehicles = vehiclesResult.data;
    organizations = orgsResult?.data ?? [];
  } catch (error) {
    console.error("devices page load failed", { message: error instanceof Error ? error.message : "unknown" });
    return <RetryAlert message="단말 목록을 불러오지 못했습니다. 네트워크 상태를 확인해주세요." />;
  }

  const serialByVehicle = new Map(devices.filter((d) => d.vehicle).map((d) => [d.vehicle?.id, d.serialNumber]));
  // 장착 대상: 단말과 같은 조직 차량(조직이 정해지지 않은 단말은 슈퍼 관리자가 아무 조직 차량에나 장착하며 그 조직 재고가 된다)
  const mountTargets = (device: DeviceListItem): MountTarget[] =>
    vehicles
      .filter((vehicle) => device.orgId === null || vehicle.org_id === device.orgId)
      .map((vehicle) => ({ id: vehicle.id, plateNumber: vehicle.plate_number, currentSerial: serialByVehicle.get(vehicle.id) ?? null }));

  const shown = devices.filter((d) => (filter === "mounted" ? d.vehicle !== null : filter === "inventory" ? d.vehicle === null : true));
  const counts = { all: devices.length, mounted: devices.filter((d) => d.vehicle).length, inventory: devices.filter((d) => !d.vehicle).length };
  const register = (label?: string) => (user.role === "super_admin" ? <RegisterDeviceDialog organizations={organizations} label={label} /> : null);

  return (
    <div className="grid gap-4">
      <Notice params={params} devices={devices} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="단말 상태 필터" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "/devices" : `/devices?filter=${f.key}`}
              aria-current={filter === f.key ? "page" : undefined}
              className={filter === f.key ? "btn" : "btn btn-secondary"}
            >
              {f.label} <span className="tabular-nums">{counts[f.key]}</span>
            </Link>
          ))}
        </nav>
        {devices.length > 0 ? register() : null}
      </div>

      {devices.length === 0 ? (
        <EmptyState icon={Cpu} title="등록된 단말기가 없습니다.">
          {user.role === "super_admin" ? (
            <>
              <p className="m-0">첫 번째 단말기를 등록해주세요.</p>
              <div className="mt-4 flex justify-center">{register("첫 단말 등록하기")}</div>
            </>
          ) : (
            <p className="m-0">우리 조직에 배정된 단말 재고가 없습니다. 페달아이 운영팀에 단말 입고를 요청해 주세요.</p>
          )}
        </EmptyState>
      ) : shown.length === 0 ? (
        <p className="m-0 rounded-md border border-dashed border-border-strong px-4 py-6 text-center text-text-muted">
          {filter === "inventory" ? "미장착 재고 단말이 없습니다." : "장착된 단말이 없습니다."}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {shown.map((device) => (
            <li key={device.id} className="grid gap-3 rounded-md border border-border bg-bg-base p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <strong className="whitespace-nowrap font-mono text-h2">{device.serialNumber}</strong>
                {device.vehicle ? (
                  <span className="rounded-md border border-border-strong px-2 text-caption font-medium">장착 완료</span>
                ) : (
                  <span className="rounded-md border border-dashed border-border-strong px-2 text-caption font-medium">미장착 재고</span>
                )}
                {device.needsCalibration ? (
                  <Link
                    href={`/devices/calibrate?deviceId=${device.id}`}
                    className="inline-flex min-h-11 items-center gap-1 rounded-md border-2 border-dual-warning bg-dual-warning/15 px-2 text-caption font-semibold text-text-main"
                  >
                    <AlertTriangle aria-hidden="true" size={16} />
                    보정 필요
                  </Link>
                ) : null}
                {device.authPublicKey ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-good bg-good-bg px-2 text-caption font-semibold text-good">
                    <ShieldCheck aria-hidden="true" size={14} />
                    인증 키 등록
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md border-2 border-dual-warning bg-dual-warning/15 px-2 text-caption font-semibold text-text-main">
                    <ShieldAlert aria-hidden="true" size={14} />
                    인증 미설정(시험 단말)
                  </span>
                )}
              </div>
              <dl className="m-0 grid gap-x-6 gap-y-1 text-text-muted sm:grid-cols-2">
                <Item label="장착 차량">
                  {device.vehicle ? (
                    <Link href={`/vehicles/${device.vehicle.id}`} className="whitespace-nowrap font-semibold text-text-main underline">
                      {device.vehicle.plateNumber}
                    </Link>
                  ) : (
                    "-"
                  )}
                </Item>
                {user.role === "super_admin" ? <Item label="재고 조직">{device.orgName ?? "미지정"}</Item> : null}
                <Item label="MAC">{device.macAddress ? <span className="font-mono">{device.macAddress}</span> : "-"}</Item>
                <Item label="HW / FW">
                  {device.hardwareRev} / {device.firmwareVersion}
                </Item>
                <Item label="인증 키">
                  {device.authPublicKey ? <span className="break-all font-mono">{maskPublicKey(device.authPublicKey)}</span> : "미등록"}
                </Item>
                <Item label="마지막 동기화">
                  {device.lastSyncedAt ? <time dateTime={device.lastSyncedAt}>{dateFormat.format(new Date(device.lastSyncedAt))}</time> : "기록 없음"}
                </Item>
              </dl>
              <div className="flex flex-wrap gap-2">
                {device.vehicle ? (
                  <UnmountDeviceDialog deviceId={device.id} serialNumber={device.serialNumber} vehicleId={device.vehicle.id} plateNumber={device.vehicle.plateNumber} />
                ) : (
                  <MountDeviceDialog deviceId={device.id} serialNumber={device.serialNumber} vehicles={mountTargets(device)} />
                )}
                {user.role === "super_admin" ? (
                  <DevicePublicKeyDialog deviceId={device.id} serialNumber={device.serialNumber} maskedKey={maskPublicKey(device.authPublicKey)} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
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

/** 등록·장착·해제 결과 안내. 서버 액션이 결과를 주소로 넘긴다. */
function Notice({ params, devices }: { params: SearchParams; devices: DeviceListItem[] }) {
  const device = devices.find((d) => d.id === params.device);
  if (!device || !params.notice) return null;
  const replaced = params.replaced && SERIAL_PATTERN.test(params.replaced) ? params.replaced : null;

  let body: React.ReactNode = null;
  if (params.notice === "registered") body = <p className="m-0">단말 {device.serialNumber}이(가) 미장착 재고로 등록되었습니다.</p>;
  if (params.notice === "key_updated") body = <p className="m-0">단말 {device.serialNumber}의 인증 공개키를 저장했습니다. 변경 내용은 감사 로그에 남았습니다.</p>;
  if (params.notice === "key_revoked") body = <p className="m-0">단말 {device.serialNumber}의 인증 공개키 등록을 해제했습니다(시험 단말).</p>;
  if (params.notice === "unmounted") body = <p className="m-0">단말 {device.serialNumber}의 장착을 해제했습니다. 미장착 재고로 전환되었습니다.</p>;
  if (params.notice === "mounted" && device.vehicle) {
    body = (
      <>
        <p className="m-0">
          단말 {device.serialNumber}을(를) {device.vehicle.plateNumber}에 장착했습니다.
          {replaced ? ` 기존 단말 ${replaced}은(는) 미장착 재고로 전환되었습니다.` : ""}
        </p>
        <p className="m-0 font-normal text-text-main">정확한 계측을 위해 지금 페달 보정을 진행해 주세요.</p>
        <Link href={`/devices/calibrate?deviceId=${device.id}`} className="btn justify-self-start">
          지금 바로 보정하기
        </Link>
      </>
    );
  }
  if (!body) return null;
  return (
    <div role="status" className="grid gap-2 rounded-md border border-border-strong bg-good-bg px-4 py-3 font-semibold text-good">
      <div className="flex items-start gap-2">
        <CheckCircle2 aria-hidden="true" size={20} className="mt-0.5 shrink-0" />
        <div className="grid gap-2">{body}</div>
      </div>
    </div>
  );
}

function DevicesSkeleton() {
  return (
    <div className="grid gap-3" role="status" aria-label="단말 목록을 불러오는 중">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid gap-2 rounded-md border border-border bg-bg-base p-4">
          <div className="h-5 w-1/2 rounded-md bg-border motion-safe:animate-pulse" />
          <div className="h-4 w-3/4 rounded-md bg-border motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}
