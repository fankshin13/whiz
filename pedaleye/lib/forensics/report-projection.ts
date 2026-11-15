import "server-only";

import QRCode from "qrcode";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { computeStatistics, downsampleMinMax, dualPressRanges, selectLedger, triggerIndex } from "@/lib/forensics/report-math";
import { toSeoulIso } from "@/lib/forensics/integrity-engine";
import { loadSessionForensics } from "@/lib/forensics/session-forensics";
import { getAppBaseUrl } from "@/lib/server/env";
import { createClient } from "@/lib/supabase/server";
import type { ForensicReportData } from "@/types/forensic-report";

export const REPORT_NOT_AVAILABLE = "보고서를 조회할 수 있는 권한이 없거나 존재하지 않는 세션입니다.";
export const REPORT_EMPTY = "기록된 페달 조작 패킷이 없어 보고서를 출력할 수 없습니다.";

export type ReportProjectionResult =
  | { success: true; data: ForensicReportData; verifyUrl: string; qrSvg: string }
  | { success: false; kind: "forbidden" | "empty" | "error"; error: string };

/**
 * 보고서 데이터. 권한·원본 다운로드·전수 검증은 loadSessionForensics(사용자 클라이언트·RLS)를 그대로 쓰고,
 * 보고서용 차량·단말·조직 정보만 더 읽는다. service_role 은 쓰지 않는다.
 */
export async function getForensicReportProjection(sessionId: string): Promise<ReportProjectionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, kind: "forbidden", error: REPORT_NOT_AVAILABLE };

  const supabase = await createClient();
  const loaded = await loadSessionForensics(supabase, user, sessionId);
  if (!loaded.success) {
    if (loaded.status === 403 || loaded.status === 404) return { success: false, kind: "forbidden", error: REPORT_NOT_AVAILABLE };
    return { success: false, kind: "error", error: `보고서를 생성할 수 없습니다: ${loaded.error}` };
  }
  const { data } = loaded;
  if (data.packets.length === 0) return { success: false, kind: "empty", error: REPORT_EMPTY };

  const { data: device, error } = await supabase
    .from("devices")
    .select(
      "hardware_rev, firmware_version, accel_calib_min, accel_calib_max, brake_calib_min, brake_calib_max, vehicle:vehicles!inner(model_name, vin_masked, organization:organizations!inner(name))",
    )
    .eq("id", data.deviceId)
    .maybeSingle();
  if (error || !device) {
    console.error("report metadata query failed", { code: error?.code ?? "missing" });
    return { success: false, kind: "error", error: "보고서를 생성할 수 없습니다: 차량·단말 정보를 불러오지 못했습니다." };
  }

  const verifyUrl = `${getAppBaseUrl()}/events/${data.sessionId}`;
  const qrSvg = await QRCode.toString(verifyUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" });

  return {
    success: true,
    verifyUrl,
    qrSvg,
    data: {
      sessionId: data.sessionId,
      metadata: {
        reportNumber: `PEDAL-FORENSIC-${data.sessionId.slice(0, 8).toUpperCase()}`,
        generatedAt: toSeoulIso(Date.now()),
        organizationName: device.vehicle.organization.name,
        plateNumber: data.plateNumber,
        modelName: device.vehicle.model_name,
        vinMasked: device.vehicle.vin_masked,
        deviceSerialNumber: data.deviceSerialNumber,
        hardwareRev: device.hardware_rev,
        firmwareVersion: device.firmware_version,
        accelStrokeMm: (device.accel_calib_max - device.accel_calib_min) / 100,
        brakeStrokeMm: (device.brake_calib_max - device.brake_calib_min) / 100,
      },
      triggerType: data.triggerType,
      startTime: data.startTime,
      endTime: data.endTime,
      triggerTimeMs: data.packets[triggerIndex(data.packets)]?.timestampUtc ?? 0,
      verification: data.verification,
      statistics: computeStatistics(data.packets),
      timeSeriesSample: downsampleMinMax(data.packets),
      dualRanges: dualPressRanges(data.packets),
      auditLedgerSample: selectLedger(data.packets),
    },
  };
}
