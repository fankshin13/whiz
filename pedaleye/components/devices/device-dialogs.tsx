"use client";

import { Link2, Plus, Unlink } from "lucide-react";
import { useActionState, useRef, useState } from "react";

import { ModalDialog } from "@/components/page/modal-dialog";
import {
  mountDeviceAction,
  registerDeviceAction,
  unmountDeviceAction,
  type MountDeviceState,
  type RegisterDeviceState,
  type UnmountDeviceState,
} from "@/lib/devices/actions";

function ErrorSlot({ error }: { error: string | null }) {
  return (
    <div aria-live="polite">
      {error ? (
        <p className="alert m-0" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

// ── 단말 등록(슈퍼 관리자) ──────────────────────────────────────────────

const initialRegisterState: RegisterDeviceState = { ok: null };

export function RegisterDeviceDialog({ organizations, label }: { organizations: { id: string; name: string }[]; label?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <button
        type="button"
        className="btn"
        aria-haspopup="dialog"
        onClick={() => {
          setFormKey((key) => key + 1);
          dialogRef.current?.showModal();
        }}
      >
        <Plus aria-hidden="true" size={18} />
        {label ?? "신규 단말 등록"}
      </button>
      <ModalDialog
        id="device-register"
        dialogRef={dialogRef}
        title="신규 단말 등록"
        description="입고된 단말을 조직의 미장착 재고로 등록합니다. 등록 후 그 조직 차량에 장착할 수 있습니다."
      >
        <RegisterForm key={formKey} organizations={organizations} />
      </ModalDialog>
    </>
  );
}

function RegisterForm({ organizations }: { organizations: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(registerDeviceAction, initialRegisterState);
  const values =
    state.ok === false
      ? state.values
      : { orgId: organizations[0]?.id ?? "", serialNumber: "", macAddress: "", hardwareRev: "v1.0", firmwareVersion: "1.0.0" };
  const field = (name: string) => `device-register-${name}`;

  if (organizations.length === 0) {
    return <p className="alert m-0">단말을 배정할 조직이 없습니다. 조직 관리에서 조직을 먼저 만들어 주세요.</p>;
  }

  return (
    <form action={formAction} className="grid gap-4" aria-busy={pending}>
      <ErrorSlot error={state.ok === false ? state.error : null} />
      <div className="grid gap-1">
        <label htmlFor={field("org")} className="font-semibold">
          재고 조직
        </label>
        <select key={`org-${values.orgId}`} id={field("org")} name="orgId" className="input" defaultValue={values.orgId} required disabled={pending}>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <label htmlFor={field("serial")} className="font-semibold">
          단말 일련번호
        </label>
        <input
          key={`serial-${values.serialNumber}`}
          id={field("serial")}
          name="serialNumber"
          className="input"
          required
          maxLength={14}
          placeholder="예: PE-2026-000001"
          aria-describedby={field("serial-hint")}
          defaultValue={values.serialNumber}
          autoCapitalize="characters"
          spellCheck={false}
          disabled={pending}
        />
        <span id={field("serial-hint")} className="text-caption text-text-muted">
          형식: PE-연도4자리-번호6자리
        </span>
      </div>
      <div className="grid gap-1">
        <label htmlFor={field("mac")} className="font-semibold">
          MAC 주소 <span className="font-normal text-text-muted">(선택)</span>
        </label>
        <input
          key={`mac-${values.macAddress}`}
          id={field("mac")}
          name="macAddress"
          className="input"
          maxLength={17}
          placeholder="예: AA:BB:CC:DD:EE:FF"
          defaultValue={values.macAddress}
          autoCapitalize="characters"
          spellCheck={false}
          disabled={pending}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor={field("hw")} className="font-semibold">
            하드웨어 버전
          </label>
          <input key={`hw-${values.hardwareRev}`} id={field("hw")} name="hardwareRev" className="input" maxLength={20} defaultValue={values.hardwareRev} disabled={pending} />
        </div>
        <div className="grid gap-1">
          <label htmlFor={field("fw")} className="font-semibold">
            펌웨어 버전
          </label>
          <input key={`fw-${values.firmwareVersion}`} id={field("fw")} name="firmwareVersion" className="input" maxLength={20} defaultValue={values.firmwareVersion} disabled={pending} />
        </div>
      </div>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? (
          <>
            <Spinner />
            등록 중...
          </>
        ) : (
          "단말 등록"
        )}
      </button>
    </form>
  );
}

// ── 차량 장착·교체 ─────────────────────────────────────────────────────

export interface MountTarget {
  id: string;
  plateNumber: string;
  currentSerial: string | null;
}

const initialMountState: MountDeviceState = { ok: null };

export function MountDeviceDialog({ deviceId, serialNumber, vehicles }: { deviceId: string; serialNumber: string; vehicles: MountTarget[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const id = `device-mount-${deviceId}`;

  return (
    <>
      <button
        type="button"
        className="btn"
        aria-haspopup="dialog"
        onClick={() => {
          setFormKey((key) => key + 1);
          dialogRef.current?.showModal();
        }}
      >
        <Link2 aria-hidden="true" size={18} />
        차량에 장착
      </button>
      <ModalDialog id={id} dialogRef={dialogRef} title="차량에 단말 장착" description={`단말 ${serialNumber}를 장착할 차량을 선택합니다.`}>
        <MountForm key={formKey} id={id} deviceId={deviceId} vehicles={vehicles} close={() => dialogRef.current?.close()} />
      </ModalDialog>
    </>
  );
}

function MountForm({ id, deviceId, vehicles, close }: { id: string; deviceId: string; vehicles: MountTarget[]; close: () => void }) {
  const [state, formAction, pending] = useActionState(mountDeviceAction, initialMountState);
  const [vehicleId, setVehicleId] = useState(state.ok === false ? state.vehicleId : "");
  const selected = vehicles.find((vehicle) => vehicle.id === vehicleId);
  const field = (name: string) => `${id}-${name}`;

  if (vehicles.length === 0) {
    return <p className="alert m-0">장착할 수 있는 차량이 없습니다. 차량 관리에서 차량을 먼저 등록해 주세요.</p>;
  }

  return (
    <form action={formAction} className="grid gap-4" aria-busy={pending}>
      <ErrorSlot error={state.ok === false ? state.error : null} />
      <input type="hidden" name="deviceId" value={deviceId} />
      <div className="grid gap-1">
        <label htmlFor={field("vehicle")} className="font-semibold">
          장착 차량
        </label>
        <select
          id={field("vehicle")}
          name="vehicleId"
          className="input"
          required
          value={vehicleId}
          onChange={(event) => setVehicleId(event.target.value)}
          disabled={pending}
        >
          <option value="" disabled>
            차량을 선택해 주세요
          </option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.plateNumber} · {vehicle.currentSerial ? `장착 중: ${vehicle.currentSerial}` : "단말 없음"}
            </option>
          ))}
        </select>
      </div>
      {selected?.currentSerial ? (
        <div className="grid gap-3 rounded-md border-2 border-dual-warning bg-dual-warning/15 p-3">
          <p className="m-0 font-semibold">
            주의: 선택한 차량에 이미 단말({selected.currentSerial})이 장착되어 있습니다. 계속 진행하면 기존 단말은 자동으로 해제(재고 전환)되며, 새
            단말은 장착 직후 페달 보정 작업이 필요합니다.
          </p>
          <label className="flex min-h-11 items-center gap-3 font-semibold">
            <input type="checkbox" name="replace" required className="size-5" disabled={pending} />
            기존 단말을 해제하고 교체합니다
          </label>
        </div>
      ) : (
        <p className="m-0 text-caption text-text-muted">장착하면 단말 보정값이 공장 기본값으로 초기화되며, 장착 직후 페달 보정이 필요합니다.</p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn" disabled={pending || !vehicleId}>
          {pending ? <Spinner /> : <Link2 aria-hidden="true" size={18} />}
          {pending ? "장착 중..." : selected?.currentSerial ? "교체 장착" : "장착"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={close} disabled={pending}>
          취소
        </button>
      </div>
    </form>
  );
}

// ── 장착 해제 ──────────────────────────────────────────────────────────

const initialUnmountState: UnmountDeviceState = { ok: null, error: null };

export function UnmountDeviceDialog({ deviceId, serialNumber, vehicleId, plateNumber }: { deviceId: string; serialNumber: string; vehicleId: string; plateNumber: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(unmountDeviceAction, initialUnmountState);

  return (
    <>
      <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        <Unlink aria-hidden="true" size={18} />
        장착 해제
      </button>
      <ModalDialog id={`device-unmount-${deviceId}`} dialogRef={dialogRef} title="단말 장착을 해제하시겠습니까?" description={`${plateNumber} · ${serialNumber}`}>
        <form action={formAction} className="grid gap-4" aria-busy={pending}>
          <input type="hidden" name="deviceId" value={deviceId} />
          <input type="hidden" name="vehicleId" value={vehicleId} />
          <p className="alert m-0">
            정말 {plateNumber}에서 단말 {serialNumber}를 해제하시겠습니까? 해제된 단말은 미장착 재고로 전환됩니다.
          </p>
          <ErrorSlot error={state.ok === false ? state.error : null} />
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn border-critical bg-critical text-white" disabled={pending}>
              {pending ? <Spinner /> : <Unlink aria-hidden="true" size={18} />}
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
