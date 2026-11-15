import "server-only";

import { buildFleetOverview, type SessionRow, type VehicleRow } from "@/lib/fleet/overview";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import type { FleetDashboardOverview } from "@/types/fleet-monitoring";

export type FleetOverviewResult =
  | { success: true; data: FleetDashboardOverview }
  | { success: false; error: "UNAUTHORIZED" | "FORBIDDEN" | "QUERY_FAILED" };

/**
 * 관제 읽기 프로젝션. 사용자 클라이언트(RLS)로 읽으므로 org_admin 은 소속 조직 행만 받는다.
 * 그 위에 역할과 조직 ID 를 한 번 더 확인해 다른 조직 행이 섞이지 않게 한다.
 */
export async function getFleetMonitoringOverview(periodDays: number): Promise<FleetOverviewResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "UNAUTHORIZED" };
  if (user.role !== "super_admin" && !(user.role === "org_admin" && user.orgId)) return { success: false, error: "FORBIDDEN" };

  const supabase = await createClient();
  const nowMs = Date.now();
  let vehicleQuery = supabase
    .from("vehicles")
    .select(
      "id, org_id, plate_number, model_name, model_year, driver:users!vehicles_assigned_user_id_fkey(name), device:devices(id, serial_number, last_synced_at, accel_calib_min, accel_calib_max, brake_calib_min, brake_calib_max)",
    )
    .order("plate_number");
  if (user.role === "org_admin" && user.orgId) vehicleQuery = vehicleQuery.eq("org_id", user.orgId);

  const [vehiclesResult, orgResult] = await Promise.all([
    vehicleQuery,
    user.role === "org_admin" && user.orgId
      ? supabase.from("organizations").select("name").eq("id", user.orgId).maybeSingle()
      : Promise.resolve({ data: { name: "전체 조직" }, error: null }),
  ]);
  if (vehiclesResult.error || orgResult.error) {
    console.error("fleet overview query failed", { code: vehiclesResult.error?.code ?? orgResult.error?.code });
    return { success: false, error: "QUERY_FAILED" };
  }

  const vehicles: VehicleRow[] = vehiclesResult.data;
  const deviceIds = vehicles.flatMap((v) => (v.device ? [v.device.id] : []));
  let sessions: SessionRow[] = [];
  if (deviceIds.length) {
    const { data, error } = await supabase
      .from("event_sessions")
      .select("id, device_id, trigger_type, start_time, integrity_verified")
      .in("device_id", deviceIds)
      .gte("start_time", new Date(nowMs - periodDays * 86_400_000).toISOString());
    if (error) {
      console.error("fleet sessions query failed", { code: error.code });
      return { success: false, error: "QUERY_FAILED" };
    }
    sessions = data;
  }

  return { success: true, data: buildFleetOverview(orgResult.data?.name ?? "", vehicles, sessions, nowMs, periodDays) };
}
