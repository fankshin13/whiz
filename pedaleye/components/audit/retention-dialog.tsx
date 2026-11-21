"use client";

import { Archive } from "lucide-react";
import { useActionState, useRef, useState } from "react";

import { ModalDialog } from "@/components/page/modal-dialog";
import { RETENTION_CONFIRM_PHRASE } from "@/lib/audit/labels";
import { runAuditRetentionAction, type RetentionState } from "@/lib/audit/retention-actions";

const initialState: RetentionState = { ok: null };

/** 보존 기간이 지난 감사 로그를 지금 아카이브하고 삭제한다(슈퍼 관리자). 확인 문구를 입력해야 실행된다. */
export function RunRetentionDialog({ expiredCount, cutoffLabel }: { expiredCount: number; cutoffLabel: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const disabled = expiredCount === 0;

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        aria-haspopup="dialog"
        disabled={disabled}
        aria-describedby={disabled ? "retention-none-note" : undefined}
        onClick={() => {
          setFormKey((k) => k + 1);
          dialogRef.current?.showModal();
        }}
      >
        <Archive aria-hidden="true" size={18} />
        지금 아카이브 후 삭제
      </button>
      {disabled ? (
        <span id="retention-none-note" className="text-caption text-text-muted">
          보존 기간이 지난 기록이 없습니다
        </span>
      ) : null}
      <ModalDialog
        id="audit-retention"
        dialogRef={dialogRef}
        title="보존 기간이 지난 감사 로그를 정리하시겠습니까?"
        description={`${cutoffLabel} 이전 기록 ${expiredCount.toLocaleString("ko-KR")}건`}
      >
        <RetentionForm key={formKey} close={() => dialogRef.current?.close()} />
      </ModalDialog>
    </>
  );
}

function RetentionForm({ close }: { close: () => void }) {
  const [state, formAction, pending] = useActionState(runAuditRetentionAction, initialState);

  return (
    <form action={formAction} className="grid gap-4" aria-busy={pending}>
      <p className="alert m-0">
        대상 기록 전체를 CSV 파일로 비공개 저장소에 보관한 뒤, 건수와 지문이 일치할 때만 삭제합니다. 삭제한 기록은 이 화면에서 다시 볼 수 없고,
        아카이브 파일로만 확인할 수 있습니다.
      </p>
      <div className="grid gap-1">
        <label htmlFor="retention-confirm" className="font-semibold">
          확인 문구 입력 <span className="font-normal text-text-muted">({RETENTION_CONFIRM_PHRASE})</span>
        </label>
        <input id="retention-confirm" name="confirm" className="input" autoComplete="off" required disabled={pending} />
      </div>
      <div aria-live="polite">
        {state.ok === false ? (
          <p className="alert m-0" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn border-critical bg-critical text-white" disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : <Archive aria-hidden="true" size={18} />}
          {pending ? "아카이브·삭제 중..." : "아카이브 후 삭제"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={close} disabled={pending}>
          취소
        </button>
      </div>
    </form>
  );
}
