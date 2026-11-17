"use client";

import { UserCheck, UserX } from "lucide-react";
import { useActionState, useRef, useState } from "react";

import { ModalDialog } from "@/components/page/modal-dialog";
import { setUserActiveAction, type SetActiveState } from "@/lib/users/actions";

const initialState: SetActiveState = { ok: null };

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: string;
  vehicles: string[]; // 배정 차량 번호
}

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

/**
 * 계정 비활성화. 배정 차량이 있으면 해제 여부(기본 체크), 조직 관리자 대상이면(슈퍼 관리자만) 비활성화/운전자 강등 선택.
 * 본인 계정이면 버튼 대신 안내만 보인다(서버·DB 가 한 번 더 막음).
 */
export function DeactivateUserDialog({ user, isSelf, returnQuery }: { user: ManagedUser; isSelf: boolean; returnQuery: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const id = `user-deactivate-${user.id}`;

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        aria-haspopup="dialog"
        onClick={() => {
          setFormKey((k) => k + 1);
          dialogRef.current?.showModal();
        }}
      >
        <UserX aria-hidden="true" size={18} />
        계정 비활성화
      </button>
      <ModalDialog id={id} dialogRef={dialogRef} title="계정을 비활성화하시겠습니까?" description={`${user.name} · ${user.email}`}>
        {isSelf ? (
          <p className="alert m-0" role="alert">
            본인 계정은 비활성화할 수 없습니다.
          </p>
        ) : (
          <DeactivateForm key={formKey} id={id} user={user} returnQuery={returnQuery} close={() => dialogRef.current?.close()} />
        )}
      </ModalDialog>
    </>
  );
}

function DeactivateForm({ id, user, returnQuery, close }: { id: string; user: ManagedUser; returnQuery: string; close: () => void }) {
  const [state, formAction, pending] = useActionState(setUserActiveAction, initialState);
  const [mode, setMode] = useState<"deactivate" | "demote">("deactivate");
  const isOrgAdmin = user.role === "org_admin";

  return (
    <form action={formAction} className="grid gap-4" aria-busy={pending}>
      <input type="hidden" name="userId" value={user.id} />
      <input type="hidden" name="returnQuery" value={returnQuery} />
      <input type="hidden" name="mode" value={mode} />
      {isOrgAdmin ? (
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-2 font-semibold">조직 관리자 해제 방법</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input type="radio" name="modeChoice" className="size-5" checked={mode === "deactivate"} onChange={() => setMode("deactivate")} disabled={pending} />
            계정을 완전히 비활성화 (로그인 차단)
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input type="radio" name="modeChoice" className="size-5" checked={mode === "demote"} onChange={() => setMode("demote")} disabled={pending} />
            운전자(driver)로 역할을 강등하고 유지
          </label>
        </fieldset>
      ) : null}
      <p className="alert m-0">
        {mode === "demote"
          ? "조직 관리 권한이 즉시 회수되고 운전자 권한만 남습니다. 계정과 로그인은 유지됩니다."
          : "계정을 비활성화하면 현재 로그인 세션이 즉시 만료되며 웹 및 앱 접근이 차단됩니다. 기록은 삭제되지 않으며 나중에 재활성화할 수 있습니다."}
      </p>
      {user.vehicles.length > 0 ? (
        <label className="flex min-h-11 items-center gap-3 font-semibold">
          <input type="checkbox" name="unassignVehicle" defaultChecked className="size-5" disabled={pending} />
          {user.vehicles.join(", ")} 배정을 즉시 해제합니다
        </label>
      ) : null}
      <div className="grid gap-1">
        <label htmlFor={`${id}-reason`} className="font-semibold">
          사유 <span className="font-normal text-text-muted">(선택, 감사 로그에 기록)</span>
        </label>
        <input id={`${id}-reason`} name="reason" className="input" maxLength={200} placeholder="예: 퇴사, 담당 변경" disabled={pending} />
      </div>
      <ErrorSlot error={state.ok === false ? state.error : null} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn border-critical bg-critical text-white" disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : <UserX aria-hidden="true" size={18} />}
          {pending ? "비활성화 처리 중..." : mode === "demote" ? "운전자로 강등" : "비활성화"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={close} disabled={pending}>
          취소
        </button>
      </div>
    </form>
  );
}

/** 계정 재활성화 확인 */
export function ReactivateUserDialog({ user, returnQuery }: { user: ManagedUser; returnQuery: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(setUserActiveAction, initialState);

  return (
    <>
      <button type="button" className="btn" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        <UserCheck aria-hidden="true" size={18} />
        계정 재활성화
      </button>
      <ModalDialog id={`user-reactivate-${user.id}`} dialogRef={dialogRef} title="계정을 재활성화하시겠습니까?" description={`${user.name} · ${user.email}`}>
        <form action={formAction} className="grid gap-4" aria-busy={pending}>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="returnQuery" value={returnQuery} />
          <input type="hidden" name="mode" value="reactivate" />
          <p className="m-0">해당 계정의 로그인을 다시 허용하시겠습니까? 비활성화 해제 즉시 이전 권한으로 로그인할 수 있습니다.</p>
          <p className="m-0 text-caption text-text-muted">비활성화 때 해제한 차량 배정은 자동으로 복구되지 않습니다. 필요하면 차량 관리에서 다시 초대해 주세요.</p>
          <ErrorSlot error={state.ok === false ? state.error : null} />
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn" disabled={pending}>
              {pending ? <span className="spinner" aria-hidden="true" /> : <UserCheck aria-hidden="true" size={18} />}
              {pending ? "처리 중..." : "재활성화"}
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
