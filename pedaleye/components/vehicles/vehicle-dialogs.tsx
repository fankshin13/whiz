"use client";

import { Pencil, Plus, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { ModalDialog } from "@/components/page/modal-dialog";
import {
  saveVehicleAction,
  unassignDriverAction,
  type UnassignState,
  type VehicleFormState,
} from "@/lib/vehicles/actions";

export interface VehicleFormValues {
  id: string;
  plateNumber: string;
  modelName: string;
  modelYear: number | null;
  vinMasked: string | null;
  orgName: string;
}

/**
 * 차량 등록(vehicle 없음)·수정(vehicle 있음).
 * 슈퍼 관리자는 등록할 때 조직을 고르고, 조직 관리자는 자기 조직으로 고정된다. 수정할 때 조직은 바꿀 수 없다.
 */
export function VehicleFormDialog({
  vehicle,
  organizations,
  fixedOrgName,
  label,
}: {
  vehicle?: VehicleFormValues;
  /** 슈퍼 관리자가 등록할 때 고를 조직 목록 */
  organizations?: { id: string; name: string }[];
  /** 조직 관리자의 소속 조직명(고정 표시) */
  fixedOrgName?: string;
  label?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const editing = !!vehicle;
  const id = editing ? `vehicle-edit-${vehicle.id}` : "vehicle-create";

  return (
    <>
      <button
        type="button"
        className={editing ? "btn btn-secondary" : "btn"}
        aria-haspopup="dialog"
        onClick={() => {
          setFormKey((key) => key + 1);
          dialogRef.current?.showModal();
        }}
      >
        {editing ? <Pencil aria-hidden="true" size={18} /> : <Plus aria-hidden="true" size={18} />}
        {label ?? (editing ? "정보 수정" : "신규 차량 등록")}
      </button>
      <ModalDialog
        id={id}
        dialogRef={dialogRef}
        title={editing ? "차량 정보 수정" : "신규 차량 등록"}
        description={editing ? "차량 번호·모델·연식·차대번호를 바꿉니다. 소속 조직은 바꿀 수 없습니다." : "차량을 등록하면 운전자를 초대하고 단말을 장착할 수 있습니다."}
      >
        <VehicleForm key={formKey} id={id} vehicle={vehicle} organizations={organizations} fixedOrgName={fixedOrgName} close={() => dialogRef.current?.close()} />
      </ModalDialog>
    </>
  );
}

const initialVehicleState: VehicleFormState = { ok: null };

function VehicleForm({
  id,
  vehicle,
  organizations,
  fixedOrgName,
  close,
}: {
  id: string;
  vehicle?: VehicleFormValues;
  organizations?: { id: string; name: string }[];
  fixedOrgName?: string;
  close: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveVehicleAction, initialVehicleState);
  const router = useRouter();

  useEffect(() => {
    if (!state.ok) return;
    close();
    // 결과 안내는 화면 위쪽 상태 문구로 보여 준다
    router.replace(state.created ? `/vehicles?notice=created` : `/vehicles/${state.id}?notice=updated`);
  }, [state, close, router]);

  const values =
    state.ok === false
      ? state.values
      : {
          orgId: organizations?.[0]?.id ?? "",
          plateNumber: vehicle?.plateNumber ?? "",
          modelName: vehicle?.modelName ?? "",
          modelYear: vehicle?.modelYear ? String(vehicle.modelYear) : "",
          vinMasked: vehicle?.vinMasked ?? "",
        };
  const field = (name: string) => `${id}-${name}`;

  return (
    <form action={formAction} className="grid gap-4" aria-busy={pending}>
      <div aria-live="polite">
        {state.ok === false ? (
          <p className="alert m-0" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      {vehicle ? <input type="hidden" name="id" value={vehicle.id} /> : null}

      <div className="grid gap-1">
        {vehicle || !organizations ? (
          <>
            <span className="font-semibold">소속 조직</span>
            <span className="text-text-muted">{vehicle?.orgName ?? fixedOrgName ?? "-"}</span>
          </>
        ) : (
          <>
            <label htmlFor={field("org")} className="font-semibold">
              소속 조직
            </label>
            <select key={`org-${values.orgId}`} id={field("org")} name="orgId" className="input" defaultValue={values.orgId} required disabled={pending}>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="grid gap-1">
        <label htmlFor={field("plate")} className="font-semibold">
          차량 번호
        </label>
        <input
          key={`plate-${values.plateNumber}`}
          id={field("plate")}
          name="plateNumber"
          className="input"
          required
          maxLength={20}
          placeholder="예: 12가 3456"
          aria-describedby={field("plate-hint")}
          defaultValue={values.plateNumber}
          disabled={pending}
        />
        <span id={field("plate-hint")} className="text-caption text-text-muted">
          예: 12가 3456, 123가 4567, 서울32바 1234
        </span>
      </div>
      <div className="grid gap-1">
        <label htmlFor={field("model")} className="font-semibold">
          모델명
        </label>
        <input key={`model-${values.modelName}`} id={field("model")} name="modelName" className="input" required maxLength={100} placeholder="예: 아이오닉 5" defaultValue={values.modelName} disabled={pending} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor={field("year")} className="font-semibold">
            연식 <span className="font-normal text-text-muted">(선택)</span>
          </label>
          <input key={`year-${values.modelYear}`} id={field("year")} name="modelYear" className="input" inputMode="numeric" maxLength={4} placeholder="예: 2024" defaultValue={values.modelYear} disabled={pending} />
        </div>
        <div className="grid gap-1">
          <label htmlFor={field("vin")} className="font-semibold">
            차대번호 일부 <span className="font-normal text-text-muted">(선택)</span>
          </label>
          <input key={`vin-${values.vinMasked}`} id={field("vin")} name="vinMasked" className="input" maxLength={17} placeholder="예: KMH*1234" defaultValue={values.vinMasked} disabled={pending} />
        </div>
      </div>
      <p className="m-0 text-caption text-text-muted">차대번호는 개인정보 보호를 위해 일부를 가린 값만 넣어 주세요.</p>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? (
          <>
            <span className="spinner" aria-hidden="true" />
            저장 중...
          </>
        ) : vehicle ? (
          "변경 저장"
        ) : (
          "차량 등록"
        )}
      </button>
    </form>
  );
}

const initialUnassignState: UnassignState = { ok: null, error: null };

/** 배정 운전자 해제(확인 대화상자) */
export function UnassignDriverDialog({ vehicleId, driverName }: { vehicleId: string; driverName: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(unassignDriverAction, initialUnassignState);
  const id = `unassign-${vehicleId}`;

  return (
    <>
      <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        <UserMinus aria-hidden="true" size={18} />
        배정 해제
      </button>
      <ModalDialog
        id={id}
        dialogRef={dialogRef}
        title="운전자 배정을 해제하시겠습니까?"
        description={`${driverName}님의 배정을 해제합니다.`}
      >
        <form action={formAction} className="grid gap-4" aria-busy={pending}>
          <input type="hidden" name="vehicleId" value={vehicleId} />
          <p className="alert m-0">
            운전자 배정을 해제하면 해당 운전자는 모바일 앱 및 웹 콘솔에서 본 차량과 과거 주행·사고 기록을 더 이상 조회할 수 없습니다. 배정 해제 후
            새로운 운전자를 초대할 수 있습니다.
          </p>
          <div aria-live="polite">
            {state.ok === false ? (
              <p className="alert m-0" role="alert">
                {state.error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn border-critical bg-critical text-white" disabled={pending}>
              {pending ? <span className="spinner" aria-hidden="true" /> : <UserMinus aria-hidden="true" size={18} />}
              {pending ? "해제 중..." : "해제 진행"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
              취소
            </button>
          </div>
        </form>
      </ModalDialog>
    </>
  );
}
