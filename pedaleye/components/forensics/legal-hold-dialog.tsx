"use client";

import { Scale } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";

import { ModalDialog } from "@/components/page/modal-dialog";
import { setLegalHoldAction, type LegalHoldState } from "@/app/(dashboard)/events/[id]/actions";

const initialState: LegalHoldState = { ok: null };

/** 법적 보존 표시·해제(슈퍼 관리자). 표시하면 생성 후 3년이 지나도 자동 파기에서 빠진다. */
export function LegalHoldDialog({ sessionId, held }: { sessionId: string; held: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
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
        <Scale aria-hidden="true" size={18} />
        {held ? "법적 보존 해제" : "법적 보존 표시"}
      </button>
      <ModalDialog
        id="legal-hold"
        dialogRef={dialogRef}
        title={held ? "법적 보존을 해제하시겠습니까?" : "이 기록을 법적 보존으로 표시하시겠습니까?"}
        description={held ? "해제하면 보관 기간(생성 후 3년)이 지난 기록은 다음 자동 파기 때 지워집니다." : "표시한 기록은 보관 기간이 지나도 자동 파기되지 않습니다."}
      >
        <HoldForm key={formKey} sessionId={sessionId} held={held} close={() => dialogRef.current?.close()} />
      </ModalDialog>
    </>
  );
}

function HoldForm({ sessionId, held, close }: { sessionId: string; held: boolean; close: () => void }) {
  const [state, formAction, pending] = useActionState(setLegalHoldAction, initialState);
  const submitted = useRef(false);
  // 성공하면 페이지가 새 상태로 다시 그려지므로 창을 닫는다
  useEffect(() => {
    if (submitted.current && !pending && state.ok === null) close();
  }, [pending, state, close]);

  return (
    <form action={formAction} onSubmit={() => (submitted.current = true)} className="grid gap-4" aria-busy={pending}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="hold" value={held ? "false" : "true"} />
      {!held ? (
        <div className="grid gap-1">
          <label htmlFor="legal-hold-reason" className="font-semibold">보존 사유(필수, 감사 로그에 기록)</label>
          <input id="legal-hold-reason" name="reason" className="input" maxLength={200} placeholder="예: 2026가단12345 손해배상 소송" required disabled={pending} />
        </div>
      ) : null}
      <div aria-live="polite">
        {state.ok === false ? (
          <p className="alert m-0" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : <Scale aria-hidden="true" size={18} />}
          {held ? "해제" : "표시"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={close} disabled={pending}>
          취소
        </button>
      </div>
    </form>
  );
}
