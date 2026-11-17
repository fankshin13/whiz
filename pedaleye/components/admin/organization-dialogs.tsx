"use client";

import { Check, Copy, Pencil, Plus, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { ModalDialog as Dialog } from "@/components/page/modal-dialog";

import {
  createOrgAdminInvitationAction,
  saveOrganizationAction,
  type OrgAdminInvitationState,
  type OrganizationFormState,
} from "@/lib/organizations/actions";
import { ORGANIZATION_TYPE_LABELS, type OrganizationType } from "@/lib/organizations/labels";

// ── 조직 생성·수정 ────────────────────────────────────────────────────────

const initialOrgState: OrganizationFormState = { ok: null };

export function OrganizationFormDialog({
  organization,
  onSaved,
}: {
  /** 없으면 새 조직 생성 */
  organization?: { id: string; name: string; type: OrganizationType };
  onSaved: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const editing = !!organization;
  const id = editing ? `org-edit-${organization.id}` : "org-create";

  const open = () => {
    setFormKey((key) => key + 1);
    dialogRef.current?.showModal();
  };

  return (
    <>
      {editing ? (
        <button type="button" className="btn btn-secondary" onClick={open} aria-haspopup="dialog">
          <Pencil aria-hidden="true" size={18} />
          수정<span className="sr-only">: {organization.name}</span>
        </button>
      ) : (
        <button type="button" className="btn" onClick={open} aria-haspopup="dialog">
          <Plus aria-hidden="true" size={18} />
          신규 조직 생성
        </button>
      )}
      <Dialog
        id={id}
        dialogRef={dialogRef}
        title={editing ? "조직 정보 수정" : "신규 조직 생성"}
        description={editing ? "조직명과 유형을 바꿉니다." : "지자체(B2G)·운수사(플릿)·일반 조직을 만듭니다."}
      >
        <OrganizationForm
          key={formKey}
          id={id}
          organization={organization}
          onSaved={(message) => {
            dialogRef.current?.close();
            onSaved(message);
          }}
        />
      </Dialog>
    </>
  );
}

function OrganizationForm({
  id,
  organization,
  onSaved,
}: {
  id: string;
  organization?: { id: string; name: string; type: OrganizationType };
  onSaved: (message: string) => void;
}) {
  const [state, formAction, pending] = useActionState(saveOrganizationAction, initialOrgState);

  useEffect(() => {
    if (state.ok) onSaved(state.message);
  }, [state, onSaved]);

  const values =
    state.ok === false ? state.values : { name: organization?.name ?? "", type: organization?.type ?? "fleet" };

  return (
    <form action={formAction} className="grid gap-4" aria-busy={pending}>
      <div aria-live="polite">
        {state.ok === false ? (
          <p className="alert m-0" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      {organization ? <input type="hidden" name="id" value={organization.id} /> : null}
      <div className="grid gap-1">
        <label htmlFor={`${id}-name`} className="font-semibold">
          조직명
        </label>
        <input
          key={`name-${values.name}`}
          id={`${id}-name`}
          name="name"
          className="input"
          required
          minLength={2}
          maxLength={50}
          defaultValue={values.name}
          disabled={pending}
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${id}-type`} className="font-semibold">
          조직 유형
        </label>
        <select
          key={`type-${values.type}`}
          id={`${id}-type`}
          name="type"
          className="input"
          defaultValue={values.type}
          disabled={pending}
        >
          {(Object.keys(ORGANIZATION_TYPE_LABELS) as OrganizationType[]).map((type) => (
            <option key={type} value={type}>
              {ORGANIZATION_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? (
          <>
            <span className="spinner" aria-hidden="true" />
            저장 중...
          </>
        ) : organization ? (
          "변경 저장"
        ) : (
          "조직 생성"
        )}
      </button>
    </form>
  );
}

// ── 조직 관리자 초대 ──────────────────────────────────────────────────────

const initialInviteState: OrgAdminInvitationState = { ok: null };

export function InviteOrgAdminDialog({ orgId, orgName }: { orgId: string; orgName: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  const router = useRouter();
  const id = `org-invite-${orgId}`;

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        aria-haspopup="dialog"
        onClick={() => {
          setFormKey((key) => key + 1);
          dialogRef.current?.showModal();
        }}
      >
        <UserPlus aria-hidden="true" size={18} />
        관리자 초대<span className="sr-only">: {orgName}</span>
      </button>
      <Dialog
        id={id}
        dialogRef={dialogRef}
        title="조직 관리자 초대"
        description={`${orgName}의 조직 관리자로 가입할 1회용 초대 링크를 만듭니다.`}
        // 링크를 복사하기 전에 목록이 갱신되면 창이 닫히므로, 창을 닫을 때 갱신한다
        onClose={() => router.refresh()}
      >
        <InviteForm key={formKey} id={id} orgId={orgId} />
      </Dialog>
    </>
  );
}

function InviteForm({ id, orgId }: { id: string; orgId: string }) {
  const [state, formAction, pending] = useActionState(createOrgAdminInvitationAction, initialInviteState);
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
            ? "초대 링크가 복사되었습니다. 대상 관리자에게 안전하게 전달하세요."
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
      <input type="hidden" name="orgId" value={orgId} />
      <p className="m-0 text-caption text-text-muted">
        역할: <strong className="text-text-main">조직 관리자</strong>(변경 불가). 자기 조직의 차량·운전자만 관리합니다.
      </p>
      <div className="grid gap-1">
        <label htmlFor={`${id}-name`} className="font-semibold">
          관리자 이름
        </label>
        <input
          key={`name-${values.name}`}
          id={`${id}-name`}
          name="name"
          className="input"
          required
          maxLength={50}
          defaultValue={values.name}
          disabled={pending}
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${id}-email`} className="font-semibold">
          관리자 이메일
        </label>
        <input
          key={`email-${values.email}`}
          id={`${id}-email`}
          name="email"
          type="email"
          className="input"
          autoComplete="off"
          required
          defaultValue={values.email}
          disabled={pending}
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor={`${id}-expiry`} className="font-semibold">
          링크 유효시간
        </label>
        <select
          key={`expiry-${values.expiresInHours}`}
          id={`${id}-expiry`}
          name="expiresInHours"
          className="input"
          defaultValue={values.expiresInHours}
          disabled={pending}
        >
          <option value="12">12시간</option>
          <option value="24">24시간</option>
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
