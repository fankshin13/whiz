"use client";

import { FileSearch, Upload, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { MALFORMED_FILE_MESSAGE, isWellFormedLog, parseAllPackets, verifyLogFileIntegrity } from "@/lib/forensics/integrity-engine";
import type { VerificationResult } from "@/types/forensics";

import { toChartPoints, type ChartPoint } from "./chart-point";
import { ForensicChart } from "./forensic-chart";
import { IntegrityBadge, TamperDetail, formatSeoulTime } from "./integrity-badge";

const MAX_BYTES = 1024 * 1024;

type Analysis =
  | { kind: "idle" }
  | { kind: "working"; name: string }
  | { kind: "error"; name: string; message: string }
  | { kind: "done"; name: string; verification: VerificationResult; points: ChartPoint[] };

/**
 * 단말·탈착 메모리에서 꺼낸 .pel 파일을 브라우저에서 바로 검증·시각화한다(서버로 보내지 않음).
 * 단말 정보 없이 검증하므로 체인 연속성·끝 해시를 확인하고, 단말 제네시스 대조는 등록된 세션 화면에서 한다.
 */
export function LogFileUploader() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [analysis, setAnalysis] = useState<Analysis>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);

  const analyze = async (file: File) => {
    if (file.size > MAX_BYTES) {
      setAnalysis({ kind: "error", name: file.name, message: "파일이 너무 큽니다(최대 1MB, 60초 사고 로그 기준)." });
      return;
    }
    setAnalysis({ kind: "working", name: file.name });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isWellFormedLog(bytes)) {
      setAnalysis({ kind: "error", name: file.name, message: MALFORMED_FILE_MESSAGE });
      return;
    }
    const verification = await verifyLogFileIntegrity(bytes);
    setAnalysis({ kind: "done", name: file.name, verification, points: toChartPoints(await parseAllPackets(bytes)) });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void analyze(file);
  };

  return (
    <>
      <button type="button" className="btn" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>
        <Upload aria-hidden="true" size={18} />
        포렌식 로그 분석(.pel) 등록
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="uploader-title"
        className="m-auto max-h-[calc(100dvh-32px)] w-[min(960px,calc(100vw-32px))] rounded-lg border border-border bg-bg-base p-0 text-text-main backdrop:bg-text-main/50"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="grid gap-4 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1">
              <h2 id="uploader-title" className="m-0 text-h2 font-semibold">
                포렌식 로그 분석
              </h2>
              <p className="m-0 text-text-muted">
                단말에서 추출한 .pel 파일의 해시 체인을 이 브라우저에서 바로 전수 검증합니다. 파일은 서버로 전송되지 않습니다.
              </p>
            </div>
            <button type="button" className="btn btn-secondary shrink-0 px-0" aria-label="분석 창 닫기" onClick={() => dialogRef.current?.close()}>
              <X aria-hidden="true" size={20} />
            </button>
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`grid justify-items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center ${dragOver ? "border-primary-action bg-bg-panel" : "border-border-strong"}`}
          >
            <FileSearch aria-hidden="true" size={28} className="text-text-muted" />
            <p className="m-0">.pel 파일을 여기에 끌어다 놓거나 파일을 선택하세요.</p>
            <label className="btn btn-secondary cursor-pointer">
              파일 선택
              <input
                ref={inputRef}
                type="file"
                accept=".pel,application/octet-stream"
                className="sr-only"
                data-pel-input
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void analyze(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>

          <div aria-live="polite" className="grid gap-4">
            {analysis.kind === "working" ? (
              <p className="m-0 flex items-center gap-2 text-text-muted">
                <span className="spinner" aria-hidden="true" />
                대용량 포렌식 데이터셋 및 해시 체인 무결성 계산 중...
              </p>
            ) : null}
            {analysis.kind === "error" ? (
              <p role="alert" className="alert m-0" data-upload-error>
                {analysis.name}: {analysis.message}
              </p>
            ) : null}
            {analysis.kind === "done" ? (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <IntegrityBadge verification={analysis.verification} />
                  <span className="text-caption text-text-muted" data-verify-ms={analysis.verification.verificationDurationMs}>
                    {analysis.name} · {analysis.verification.totalRecords.toLocaleString("ko-KR")}개 패킷 · 검증{" "}
                    {analysis.verification.verificationDurationMs}ms
                  </span>
                </div>
                {analysis.points.length ? (
                  <p className="m-0 text-caption text-text-muted">
                    기록 구간 {formatSeoulTime(analysis.points[0]?.t ?? 0)} ~ {formatSeoulTime(analysis.points[analysis.points.length - 1]?.t ?? 0)}
                  </p>
                ) : null}
                <TamperDetail verification={analysis.verification} />
                <ForensicChart key={analysis.name + analysis.verification.finalHash} points={analysis.points} />
              </div>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
