"use client";

import { Download, FileSearch } from "lucide-react";
import { useRef, useState } from "react";

import { ModalDialog } from "@/components/page/modal-dialog";

type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

function show(value: Json | undefined): string {
  if (value === undefined) return "-";
  if (value === null) return "(없음)";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** 변경 전/후를 필드별 표로 보여 준다 */
export function AuditDetailDialog({
  id,
  title,
  meta,
  summary,
}: {
  id: string;
  title: string;
  meta: { label: string; value: string }[];
  summary: Json;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const obj = summary && typeof summary === "object" && !Array.isArray(summary) ? summary : {};
  const before = (obj.before && typeof obj.before === "object" && !Array.isArray(obj.before) ? obj.before : {}) as Record<string, Json>;
  const after = (obj.after && typeof obj.after === "object" && !Array.isArray(obj.after) ? obj.after : {}) as Record<string, Json>;
  const extra = Object.fromEntries(Object.entries(obj).filter(([k]) => k !== "before" && k !== "after")) as Record<string, Json>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

  return (
    <>
      <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        <FileSearch aria-hidden="true" size={18} />
        상세
      </button>
      <ModalDialog id={`audit-${id}`} dialogRef={dialogRef} title={title} description="감사 기록은 수정하거나 삭제할 수 없습니다.">
        <dl className="m-0 grid gap-1">
          {meta.map((m) => (
            <div key={m.label} className="flex flex-wrap gap-x-2">
              <dt className="text-text-muted">{m.label}</dt>
              <dd className="m-0 min-w-0 break-all font-semibold">{m.value}</dd>
            </div>
          ))}
        </dl>
        {keys.length > 0 ? (
          <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-caption">
              <thead className="sticky top-0 bg-bg-panel">
                <tr>
                  <th scope="col" className="p-2 text-left">항목</th>
                  <th scope="col" className="p-2 text-left">변경 전</th>
                  <th scope="col" className="p-2 text-left">변경 후</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k} className="border-t border-border align-top">
                    <th scope="row" className="p-2 text-left font-mono font-medium">{k}</th>
                    <td className="break-all p-2">{show(before[k])}</td>
                    <td className="break-all p-2">{show(after[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {Object.keys(extra).length > 0 ? (
          <dl className="m-0 grid gap-1">
            {Object.entries(extra).map(([k, v]) => (
              <div key={k} className="flex flex-wrap gap-x-2">
                <dt className="text-text-muted">{k === "reason" ? "거부 사유" : k}</dt>
                <dd className="m-0 break-all">{show(v)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {keys.length === 0 && Object.keys(extra).length === 0 ? <p className="m-0 text-text-muted">변경 내용 요약이 없습니다.</p> : null}
      </ModalDialog>
    </>
  );
}

/** 현재 필터 조건으로 CSV 내려받기(중복 클릭 방지) */
export function CsvExportButton({ query }: { query: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/admin/audit/export${query ? `?${query}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "audit_logs.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("CSV 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid justify-items-end gap-1">
      <button type="button" className="btn btn-secondary" onClick={download} disabled={pending} aria-busy={pending}>
        {pending ? <span className="spinner" aria-hidden="true" /> : <Download aria-hidden="true" size={18} />}
        {pending ? "내보내는 중..." : "CSV 내보내기"}
      </button>
      <div aria-live="polite">{error ? <p role="alert" className="m-0 text-caption text-critical">{error}</p> : null}</div>
    </div>
  );
}
