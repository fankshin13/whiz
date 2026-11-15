"use client";

import { Check, Copy, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";

import { createInvitationAction, type CreateInvitationState } from "@/lib/invitations/actions";

const initialState: CreateInvitationState = { ok: null };

export function InviteDriverModal({ vehicleId, plateNumber }: { vehicleId: string; plateNumber: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const router = useRouter();

  const open = () => {
    setFormKey((key) => key + 1); // 열 때마다 새 폼(이전 결과 초기화)
    dialogRef.current?.showModal();
  };

  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={open} aria-haspopup="dialog">
        <UserPlus aria-hidden="true" size={18} />
        운전자 초대
      </button>
      <dialog
        ref={dialogRef}
        className="m-auto w-[min(480px,calc(100vw-32px))] rounded-lg border border-border bg-bg-base p-0 text-text-main backdrop:bg-text-main/50"
        aria-labelledby={`invite-title-${vehicleId}`}
        // 닫을 때 목록을 새로 받아 '초대 대기 중' 상태를 반영
        onClose={() => router.refresh()}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="grid gap-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <h2 id={`invite-title-${vehicleId}`} className="m-0 text-h2 font-semibold">
                운전자 초대
              </h2>
              <p className="m-0 text-text-muted">{plateNumber} 차량에 배정할 운전자의 1회용 초대 링크를 만듭니다.</p>
            </div>
            <button
              type="button"
              className="btn btn-secondary shrink-0 px-0"
              aria-label="초대 창 닫기"
              onClick={() => dialogRef.current?.close()}
            >
              <X aria-hidden="true" size={20} />
            </button>
          </div>
          <InviteForm key={formKey} vehicleId={vehicleId} />
        </div>
      </dialog>
    </>
  );
}

function InviteForm({ vehicleId }: { vehicleId: string }) {
  const [state, formAction, pending] = useActionState(createInvitationAction, initialState);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  if (state.ok) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(state.invitationUrl);
        setCopied("done");
      } catch (error) {
        console.error("clipboard write failed", error);
        setCopied("failed");
      }
    };

    return (
      <div className="grid gap-3">
        <label htmlFor={`invite-url-${vehicleId}`} className="font-semibold">
          1회용 초대 링크
        </label>
        <textarea
          id={`invite-url-${vehicleId}`}
          readOnly
          rows={3}
          value={state.invitationUrl}
          className="input min-h-0 resize-none py-2 font-mono text-caption break-all"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className="btn" onClick={copy}>
          {copied === "done" ? <Check aria-hidden="true" size={18} /> : <Copy aria-hidden="true" size={18} />}
          링크 복사
        </button>
        <p className="m-0 text-caption text-text-muted" role="status">
          {copied === "done"
            ? `링크가 복사되었습니다 (유효시간: ${state.expiresInHours}시간)`
            : copied === "failed"
              ? "자동 복사에 실패했습니다. 위 링크를 길게 눌러 직접 복사해 주세요."
              : `이 링크는 한 번만 사용할 수 있고 ${state.expiresInHours}시간 뒤 만료됩니다. 창을 닫으면 다시 볼 수 없습니다.`}
        </p>
      </div>
    );
  }

  const values = state.ok === false ? state.values : { name: "", email: "", expiresInHours: "24" };

  return (
    <form action={formAction} className="grid gap-4" aria-busy={pending}>
      <div aria-live="polite">
        {state.ok === false ? (
          <p className="alert m-0" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <div className="grid gap-1">
        <label htmlFor={`invite-name-${vehicleId}`} className="font-semibold">
          운전자 이름
        </label>
        <input
          key={`name-${values.name}`}
          id={`invite-name-${vehicleId}`}
          name="name"
          className="input"
          required
          maxLength={50}
          defaultValue={values.name}
          disabled={pending}
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`invite-email-${vehicleId}`} className="font-semibold">
          운전자 이메일
        </label>
        <input
          key={`email-${values.email}`}
          id={`invite-email-${vehicleId}`}
          name="email"
          type="email"
          className="input"
          autoComplete="off"
          defaultValue={values.email}
          required
          disabled={pending}
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`invite-expiry-${vehicleId}`} className="font-semibold">
          링크 유효시간
        </label>
        <select
          id={`invite-expiry-${vehicleId}`}
          name="expiresInHours"
          className="input"
          key={`expiry-${values.expiresInHours}`}
          defaultValue={values.expiresInHours}
          disabled={pending}
        >
          <option value="24">24시간</option>
          <option value="48">48시간</option>
          <option value="72">72시간</option>
        </select>
      </div>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? (
          <>
            <span className="spinner" aria-hidden="true" />
            초대 링크 생성 중...
          </>
        ) : (
          "1회용 초대 링크 생성"
        )}
      </button>
    </form>
  );
}
