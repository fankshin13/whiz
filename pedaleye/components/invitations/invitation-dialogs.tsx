"use client";

import { Check, Copy, Link2Off, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";

import { ModalDialog } from "@/components/page/modal-dialog";
import {
  reissueInvitationAction,
  revokeInvitationAction,
  type ReissueInvitationState,
  type RevokeInvitationState,
} from "@/lib/invitations/manage-actions";

export interface ManagedInvitation {
  id: string;
  inviteeName: string;
  email: string;
  vehiclePlate: string | null;
}

const initialRevoke: RevokeInvitationState = { ok: null };
const initialReissue: ReissueInvitationState = { ok: null };

/** 초대 취소 확인 */
export function RevokeInvitationDialog({ invitation, returnTo }: { invitation: ManagedInvitation; returnTo: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(revokeInvitationAction, initialRevoke);

  return (
    <>
      <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        <Link2Off aria-hidden="true" size={18} />
        초대 취소
      </button>
      <ModalDialog
        id={`invite-revoke-${invitation.id}`}
        dialogRef={dialogRef}
        title="초대 링크를 취소하시겠습니까?"
        description={`${invitation.inviteeName} · ${invitation.email}${invitation.vehiclePlate ? ` · ${invitation.vehiclePlate}` : ""}`}
      >
        <form action={formAction} className="grid gap-4" aria-busy={pending}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <p className="alert m-0">취소 즉시 기존 초대 링크는 무효화되며 운전자가 더 이상 계정을 생성할 수 없습니다. 이 작업은 되돌릴 수 없습니다.</p>
          <div aria-live="polite">
            {state.ok === false ? (
              <p className="alert m-0" role="alert">
                {state.error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn border-critical bg-critical text-white" disabled={pending}>
              {pending ? <span className="spinner" aria-hidden="true" /> : <Link2Off aria-hidden="true" size={18} />}
              {pending ? "취소 중..." : "초대 취소"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
              돌아가기
            </button>
          </div>
        </form>
      </ModalDialog>
    </>
  );
}

/** 링크 재발급: 기존 링크 폐기 + 새 1회용 링크. 창을 닫을 때 화면을 새로 받는다. */
export function ReissueInvitationDialog({ invitation }: { invitation: ManagedInvitation }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const router = useRouter();
  const id = `invite-reissue-${invitation.id}`;

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
        <RefreshCw aria-hidden="true" size={18} />
        링크 재발급
      </button>
      <ModalDialog
        id={id}
        dialogRef={dialogRef}
        title="초대 링크 재발급"
        description={`${invitation.inviteeName} · ${invitation.email}${invitation.vehiclePlate ? ` · ${invitation.vehiclePlate}` : ""}`}
        onClose={() => router.refresh()}
      >
        <ReissueForm key={formKey} id={id} invitationId={invitation.id} />
      </ModalDialog>
    </>
  );
}

function ReissueForm({ id, invitationId }: { id: string; invitationId: string }) {
  const [state, formAction, pending] = useActionState(reissueInvitationAction, initialReissue);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  if (state.ok) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(state.invitationUrl);
        setCopied("done");
      } catch {
        setCopied("failed");
      }
    };
    return (
      <div className="grid gap-3">
        <label htmlFor={`${id}-url`} className="font-semibold">
          새 1회용 초대 링크
        </label>
        <textarea
          id={`${id}-url`}
          readOnly
          rows={3}
          value={state.invitationUrl}
          className="input min-h-0 resize-none py-2 font-mono text-caption break-all"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className="btn" onClick={copy}>
          {copied === "done" ? <Check aria-hidden="true" size={18} /> : <Copy aria-hidden="true" size={18} />}
          초대 링크 복사
        </button>
        <p className="m-0 text-caption text-text-muted" role="status">
          {copied === "done"
            ? "링크가 클립보드에 복사되었습니다."
            : copied === "failed"
              ? "자동 복사에 실패했습니다. 위 링크를 길게 눌러 직접 복사해 주세요."
              : `기존 링크는 폐기되었습니다. 새 링크는 ${state.expiresInHours}시간 뒤 만료되며, 창을 닫으면 다시 볼 수 없습니다.`}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4" aria-busy={pending}>
      <input type="hidden" name="invitationId" value={invitationId} />
      <div className="grid gap-1">
        <label htmlFor={`${id}-hours`} className="font-semibold">
          유효 시간
        </label>
        <select id={`${id}-hours`} name="expiresInHours" className="input" defaultValue="24" disabled={pending}>
          <option value="24">24시간</option>
          <option value="48">48시간</option>
          <option value="72">72시간</option>
        </select>
      </div>
      <p className="m-0 text-text-muted">재발급 시 기존 링크는 즉시 폐기되며 새로운 1회용 링크가 생성됩니다.</p>
      <div aria-live="polite">
        {state.ok === false ? (
          <p className="alert m-0" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? <span className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" size={18} />}
        {pending ? "발급 중..." : "새 링크 발급"}
      </button>
    </form>
  );
}
