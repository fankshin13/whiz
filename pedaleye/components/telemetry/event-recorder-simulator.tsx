"use client";

import { CloudUpload, PlayCircle, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { uploadEventSessionAction } from "@/lib/events/actions";
import { EventRecorder, type FrozenSession } from "@/lib/telemetry/event-buffer-freezer";
import { computeGenesisHash, toHex, verifyBinaryHashChain, type HashChainVerificationResult } from "@/lib/telemetry/hash-chain-engine";
import { mockPedalHardwareStream } from "@/lib/telemetry/mock-hardware-stream";

const timeFormat = new Intl.DateTimeFormat("ko-KR", { timeStyle: "medium", timeZone: "Asia/Seoul" });

type UploadState = { kind: "idle" } | { kind: "done"; verified: boolean; broken?: number; duplicate: boolean } | { kind: "error"; message: string };

/**
 * 스마트폰·BLE 연결 없이 단말 기록기가 급제동 전후 60초를 해시 체인으로 묶는 과정을 재현한다.
 * 실제 단말에서는 같은 기록기 로직이 펌웨어에서 돌고, 앱이 나중에 파일을 올린다.
 */
export function EventRecorderSimulator({ deviceId }: { deviceId: string }) {
  const [session, setSession] = useState<FrozenSession | null>(null);
  const [check, setCheck] = useState<HashChainVerificationResult | null>(null);
  const [tamper, setTamper] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ kind: "idle" });
  const [running, setRunning] = useState(false);
  const [uploading, startUpload] = useTransition();

  const run = async () => {
    setRunning(true);
    setUpload({ kind: "idle" });
    const recorder = new EventRecorder(deviceId);
    const start = Date.now() - 100_000;
    const drive = [
      { durationMs: 20_000, accel: 0, brake: 0, speedKmh: 0 },
      { durationMs: 40_000, accel: 0.4, brake: 0, speedKmh: 50 },
      { durationMs: 500, accel: 0, brake: 0, speedKmh: 50 },
      { durationMs: 40_000, accel: 0, brake: 1, speedKmh: 0 },
    ];
    for (const sample of mockPedalHardwareStream(drive, start)) {
      recorder.ingest(sample);
      if (recorder.state === "FROZEN") break;
    }
    const frozen = await recorder.freeze();
    const genesis = toHex(await computeGenesisHash(deviceId, frozen.startTimeMs));
    setSession(frozen);
    setCheck(await verifyBinaryHashChain(frozen.bytes, { expectedInitialHash: genesis }));
    setRunning(false);
  };

  const send = () => {
    if (!session) return;
    const bytes = Uint8Array.from(session.bytes);
    if (tamper) bytes[350 * 64 + 14] = (bytes[350 * 64 + 14] ?? 0) ^ 0x01; // 패킷 #350 가속 답력 1비트 변조
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);

    startUpload(async () => {
      const result = await uploadEventSessionAction({
        deviceId,
        triggerType: session.triggerType,
        startTime: new Date(session.startTimeMs).toISOString(),
        endTime: new Date(session.endTimeMs).toISOString(),
        rawLogBase64: btoa(binary),
      });
      setUpload(
        result.success
          ? { kind: "done", verified: result.integrityVerified, broken: result.brokenSequenceId, duplicate: result.duplicate }
          : { kind: "error", message: result.error },
      );
    });
  };

  return (
    <section aria-labelledby="recorder-heading" className="card grid gap-4">
      <div className="grid gap-1">
        <h2 id="recorder-heading" className="m-0 text-h2 font-semibold">
          단말 사고 기록 시뮬레이터
        </h2>
        <p className="m-0 text-text-muted">
          스마트폰 연결 없이 단말이 급제동 전후 30초씩, 총 60초를 해시 체인으로 묶어 보관하는 과정을 재현합니다.
        </p>
      </div>

      <button type="button" className="btn justify-self-start" onClick={run} disabled={running || uploading}>
        {running ? <span className="spinner" aria-hidden="true" /> : <PlayCircle aria-hidden="true" size={18} />}
        {running ? "60초 기록 생성 중..." : "급제동 사고 시뮬레이션 실행"}
      </button>

      {session && check ? (
        <div className="grid gap-4" data-session-records={session.recordCount}>
          <dl className="m-0 grid grid-cols-2 gap-3 rounded-md border border-border bg-bg-base p-4 sm:grid-cols-4">
            <div>
              <dt className="text-caption text-text-muted">트리거</dt>
              <dd className="m-0 font-semibold">급제동 · {timeFormat.format(session.triggerAtMs)}</dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">기록 구간</dt>
              <dd className="m-0 font-semibold">
                {timeFormat.format(session.startTimeMs)}~{timeFormat.format(session.endTimeMs)}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">패킷</dt>
              <dd className="m-0 font-semibold tabular-nums">
                {session.recordCount.toLocaleString("ko-KR")}개 · {(session.bytes.length / 1024).toFixed(1)}KB
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">단말 자체 검증</dt>
              <dd className="m-0 flex items-center gap-1 font-semibold" data-local-verified={check.isValid}>
                {check.isValid ? <ShieldCheck aria-hidden="true" size={16} className="text-accel" /> : <ShieldAlert aria-hidden="true" size={16} className="text-brake" />}
                {check.isValid ? "체인 일치" : "체인 불일치"}
              </dd>
            </div>
          </dl>
          <p className="m-0 min-w-0 text-caption text-text-muted">
            최종 해시 <code className="break-all">{check.finalHash}</code>
          </p>

          <label className="flex min-h-(--size-touch) items-center gap-3 font-semibold">
            <input type="checkbox" className="size-5 accent-brake" checked={tamper} onChange={(e) => setTamper(e.currentTarget.checked)} />
            업로드 전에 1비트 변조하기(위·변조 탐지 시험)
          </label>

          <button type="button" className="btn justify-self-start" onClick={send} disabled={uploading}>
            {uploading ? <span className="spinner" aria-hidden="true" /> : <CloudUpload aria-hidden="true" size={18} />}
            {uploading ? "서버 검증 중..." : "서버에 업로드"}
          </button>

          <div aria-live="polite">
            {upload.kind === "done" ? (
              <p
                role="status"
                data-upload-verified={upload.verified}
                className={`m-0 flex items-center gap-2 rounded-md border px-4 py-3 font-semibold ${upload.verified ? "border-accel bg-accel-bg" : "border-brake bg-brake-bg"}`}
              >
                {upload.verified ? <ShieldCheck aria-hidden="true" size={20} className="text-accel" /> : <ShieldAlert aria-hidden="true" size={20} className="text-brake" />}
                {upload.verified
                  ? `서버 무결성 검증 통과(변조 없음)${upload.duplicate ? " · 이미 올린 세션입니다" : ""}`
                  : `해시 체인 불일치(변조 감지) · 패킷 #${upload.broken ?? "?"}에서 확인`}
              </p>
            ) : upload.kind === "error" ? (
              <p role="alert" className="alert m-0">
                {upload.message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
