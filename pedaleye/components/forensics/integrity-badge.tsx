import { ShieldAlert, ShieldCheck } from "lucide-react";

import type { VerificationResult } from "@/types/forensics";

const timeFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
});

export function formatSeoulTime(ms: number): string {
  return timeFormat.format(ms).replace(",", ".");
}

export function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
}

/** 무결성 판정 배지. 색과 함께 아이콘·글자로 상태를 알린다. */
export function IntegrityBadge({ verification }: { verification: VerificationResult }) {
  return verification.isValid ? (
    <p className="m-0 inline-flex items-center gap-2 rounded-md border border-good bg-good-bg px-3 py-2 font-bold text-good" data-integrity="valid">
      <ShieldCheck aria-hidden="true" size={20} />
      무결성 검증 통과 (변조 없음)
    </p>
  ) : (
    <p className="m-0 inline-flex items-center gap-2 rounded-md border border-critical bg-critical-bg px-3 py-2 font-bold text-critical" data-integrity="tampered">
      <ShieldAlert aria-hidden="true" size={20} />
      해시 체인 불일치 (변조 감지)
    </p>
  );
}

/** 변조 위치·원인·기대/실제 해시 안내 */
export function TamperDetail({ verification }: { verification: VerificationResult }) {
  const detail = verification.failureDetail;
  if (verification.isValid || !detail) return null;
  const hasPosition = detail.timestampUtc > 0;
  return (
    <div role="alert" className="grid gap-2 rounded-md border border-critical bg-critical-bg p-4">
      <p className="m-0 font-semibold text-text-main">
        {hasPosition
          ? `패킷 #${detail.failedSequenceId} (${formatSeoulTime(detail.timestampUtc)}) 시점에서 해시 체인 단절이 감지되었습니다.`
          : detail.reason}
      </p>
      {hasPosition ? <p className="m-0 text-text-muted">원인: {detail.reason}</p> : null}
      {detail.expectedHash ? (
        <dl className="m-0 grid gap-1 text-caption">
          <div className="grid gap-0.5">
            <dt className="font-semibold">예상 해시</dt>
            <dd className="m-0 font-mono break-all">{detail.expectedHash}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="font-semibold">실제 기록된 해시</dt>
            <dd className="m-0 font-mono break-all">{detail.actualHash}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
