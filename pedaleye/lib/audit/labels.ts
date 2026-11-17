import type { Database } from "@/lib/supabase/database.types";

export type AuditActionType = Database["public"]["Enums"]["audit_action_type"];
export type AuditStatus = Database["public"]["Enums"]["audit_status"];

export const AUDIT_ACTION_LABELS: Record<AuditActionType, string> = {
  ORG_CREATE: "조직 생성",
  ORG_UPDATE: "조직 수정",
  ORG_DELETE: "조직 삭제",
  VEHICLE_CREATE: "차량 등록",
  VEHICLE_UPDATE: "차량 수정",
  VEHICLE_DRIVER_UNASSIGN: "운전자 배정 해제",
  VEHICLE_DRIVER_ASSIGN: "운전자 배정",
  VEHICLE_DELETE: "차량 삭제",
  DEVICE_CREATE: "단말 등록",
  DEVICE_MOUNT: "단말 장착",
  DEVICE_REPLACE: "단말 교체",
  DEVICE_UNMOUNT: "단말 해제",
  DEVICE_CALIBRATE: "페달 보정",
  DEVICE_UPDATE: "단말 수정",
  DEVICE_DELETE: "단말 삭제",
  DEVICE_KEY_REGISTER: "단말 인증 키 등록",
  DEVICE_KEY_UPDATE: "단말 인증 키 교체",
  DEVICE_KEY_REVOKE: "단말 인증 키 해제",
  INVITATION_CREATE: "초대 생성",
  INVITATION_ACCEPT: "초대 수락",
  INVITATION_CANCEL: "초대 취소",
  INVITATION_DELETE: "초대 삭제",
  USER_DEACTIVATE: "계정 비활성화",
  USER_REACTIVATE: "계정 재활성화",
  USER_ROLE_CHANGE: "역할·소속 변경",
  REPORT_VIEW: "보고서 열람",
  REPORT_DOWNLOAD: "보고서 인쇄·저장",
};

export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABELS) as AuditActionType[];

/** 작업 분류(대상 종류) 필터 */
export const AUDIT_TARGETS = [
  { key: "organization", label: "조직" },
  { key: "vehicle", label: "차량" },
  { key: "device", label: "단말" },
  { key: "user", label: "사용자" },
  { key: "invitation", label: "초대" },
  { key: "event_report", label: "보고서" },
] as const;

export const AUDIT_STATUS_LABELS: Record<AuditStatus, string> = { SUCCESS: "성공", DENIED: "거부" };

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "슈퍼 관리자",
  org_admin: "조직 관리자",
  driver: "운전자",
  investigator: "사고조사관",
};
