"use client";

import { Check, Copy, UserSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";

import { ModalDialog } from "@/components/page/modal-dialog";
import { createInvestigatorInvitationAction, type InvestigatorInvitationState } from "@/lib/invitations/actions";

const initialState: InvestigatorInvitationState = { ok: null };

/**
 * 사고조사관 초대. 슈퍼 관리자는 조직을 고르고(organizations), 조직 관리자는 자기 조직 고정(fixedOrgName).
 * 링크를 복사하기 전에 화면이 갱신되면 창이 닫히므로 창을 닫을 때 갱신한다.
 */
export function InviteInvestigatorDialog({ organizations, fixedOrgName }: { organizations?: { id: string; name: string }[]; fixedOrgName?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        className="btn"
        aria-haspopup="dialog"
        onClick={() => {
          setFormKey((k) => k + 1);
          dialogRef.current?.showModal();
        }}
      >
        <UserSearch aria-hidden="true" size={18} />
        조사관 초대
      </button>
      <ModalDialog
        id="investigator-invite"
        dialogRef={dialogRef}
        title="사고조사관 초대"
        description="소속 조직의 사고 기록만 열람하는 조사관 계정의 1회용 초대 링크를 만듭니다. 조사관은 PC 웹 콘솔에서 가입합니다."
        onClose={() => router.refresh()}
      >
        <InvestigatorForm key={formKey} organizations={organizations} fixedOrgName={fixedOrgName} />
      </ModalDialog>
    </>
  );
}

function InvestigatorForm({ organizations, fixedOrgName }: { organizations?: { id: string; name: string }[]; fixedOrgName?: string }) {
  const [state, formAction, pending] = useActionState(createInvestigatorInvitationAction, initialState);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const id = "investigator-invite";

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
        <p className="m-0 font-semibold text-good" role="status">
          조사관 초대가 생성되었습니다.
        </p>
        <label htmlFor={`${id}-url`} className="font-semibold">
          1회용 초대 링크
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
          링크 복사
        </button>
        <p className="m-0 text-caption text-text-muted" role="status">
          {copied === "done"
            ? "링크가 클립보드에 복사되었습니다. 조사관에게 안전하게 전달하세요."
            : copied === "failed"
              ? "자동 복사에 실패했습니다. 위 링크를 길게 눌러 직접 복사해 주세요."
              : `이 링크는 한 번만 사용할 수 있고 ${state.expiresInHours}시간 뒤 만료됩니다. 창을 닫으면 다시 볼 수 없습니다.`}
        </p>
      </div>
    );
  }

  const values = state.ok === false ? state.values : { orgId: organizations?.[0]?.id ?? "", name: "", email: "", expiresInHours: "24" };

  return (
    <form action={formAction} className="grid gap-4" aria-busy={pending}>
      <div aria-live="polite">
        {state.ok === false ? (
          <p className="alert m-0" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      <div className="grid gap-1">
        {organizations ? (
          <>
            <label htmlFor={`${id}-org`} className="font-semibold">
              소속 조직
            </label>
            <select key={`org-${values.orgId}`} id={`${id}-org`} name="orgId" className="input" defaultValue={values.orgId} required disabled={pending}>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <span className="font-semibold">소속 조직</span>
            <span className="text-text-muted">{fixedOrgName ?? "-"}</span>
          </>
        )}
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${id}-name`} className="font-semibold">
          조사관 이름
        </label>
        <input key={`name-${values.name}`} id={`${id}-name`} name="name" className="input" required maxLength={50} placeholder="예: 홍길동 (OO손해사정)" defaultValue={values.name} disabled={pending} />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${id}-email`} className="font-semibold">
          조사관 이메일
        </label>
        <input key={`email-${values.email}`} id={`${id}-email`} name="email" type="email" className="input" autoComplete="off" required defaultValue={values.email} disabled={pending} />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${id}-expiry`} className="font-semibold">
          링크 유효시간
        </label>
        <select key={`expiry-${values.expiresInHours}`} id={`${id}-expiry`} name="expiresInHours" className="input" defaultValue={values.expiresInHours} disabled={pending}>
          <option value="12">12시간</option>
          <option value="24">24시간</option>
          <option value="72">72시간</option>
        </select>
      </div>
      <p className="m-0 text-caption text-text-muted">
        역할: <strong className="text-text-main">사고조사관</strong>. 차량·단말·사용자 관리는 할 수 없고 소속 조직의 사고 기록과 보고서만 열람합니다.
      </p>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? <span className="spinner" aria-hidden="true" /> : <UserSearch aria-hidden="true" size={18} />}
        {pending ? "초대 링크 만드는 중..." : "초대 링크 만들기"}
      </button>
    </form>
  );
}
