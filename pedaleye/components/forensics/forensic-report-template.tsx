import { formatSeoulTime } from "@/components/forensics/integrity-badge";
import type { ForensicReportData } from "@/types/forensic-report";

import { ForensicVectorChart, VectorChartLegend } from "./forensic-vector-chart";

const TRIGGER_LABELS = { shock: "충격 감지(3.0G 초과)", sudden_accel: "급가감속 감지", manual: "수동 긴급 백업", periodic: "정기 기록" } as const;
const ISSUER = "페달아이 무결성 검증 센터";

const th = "border border-border-strong bg-bg-panel px-2 py-1 text-left font-semibold whitespace-nowrap";
const td = "border border-border-strong px-2 py-1";
const mid = (hash: string, n = 12) => (hash.length > n * 2 ? `${hash.slice(0, n)}…${hash.slice(-n)}` : hash);

function Stamp({ report }: { report: ForensicReportData }) {
  const { verification } = report;
  if (verification.isValid) {
    return (
      <div data-report-stamp="valid" className="grid gap-1 rounded-lg border-[3px] border-double border-good bg-good-bg p-3 text-good">
        <strong className="text-[13pt]">[무결성 검증 통과] 1비트 위·변조 없음</strong>
        <span className="text-[9pt] text-text-main">
          FIPS 180-4 SHA-256 해시 체인 {verification.totalRecords.toLocaleString("ko-KR")}개 패킷 전수 재계산 · 단말 제네시스 일치 · 시퀀스 연속
        </span>
      </div>
    );
  }
  const detail = verification.failureDetail;
  return (
    <div data-report-stamp="tampered" className="grid gap-1 rounded-lg border-[3px] border-critical bg-critical-bg p-3 text-critical">
      <strong className="text-[13pt]">[무결성 훼손 감지] 해시 체인 불일치 (변조됨)</strong>
      <span className="text-[10pt] font-semibold text-text-main">
        불일치 발생 시퀀스: 패킷 #{detail?.failedSequenceId ?? "?"}
        {detail?.timestampUtc ? ` (${formatSeoulTime(detail.timestampUtc)})` : ""} · 원인: {detail?.reason ?? "확인 불가"}
      </span>
      <span className="text-[9pt] text-text-main">증거 불채택 사유: 원본 기록 이후 데이터가 변경되어 법적 증거 능력이 인정되지 않을 수 있습니다.</span>
    </div>
  );
}

function PageFooter({ page }: { page: number }) {
  return (
    <footer className="mt-auto flex items-end justify-between gap-3 border-t border-border-strong pt-2 text-[8pt] text-text-muted">
      <span>
        본 문서는 단말이 기록한 원본 로그의 해시 체인을 재계산한 결과이며, 사고 원인에 대한 감정 의견을 포함하지 않습니다. 차대번호는 마스킹되었고
        운전자 개인정보는 기재하지 않습니다.
      </span>
      <span className="shrink-0 font-semibold">{page} / 2</span>
    </footer>
  );
}

export function ForensicReportTemplate({ report, qrSvg, verifyUrl }: { report: ForensicReportData; qrSvg: string; verifyUrl: string }) {
  const { metadata: m, verification: v, statistics: s } = report;
  const tampered = !v.isValid;

  return (
    <div className="mx-auto grid w-full max-w-[210mm] gap-6 text-[10pt] print:gap-0" data-report>
      {/* 1쪽: 표제·판정·대상·개요·핵심 통계 */}
      <section className="report-page relative flex flex-col gap-4 overflow-hidden rounded-lg bg-bg-base p-5 shadow-lg sm:p-8 print:rounded-none print:p-0 print:shadow-none">
        {tampered ? <Watermark /> : null}
        <header className="grid gap-2 border-b-2 border-text-main pb-3">
          <div className="flex flex-wrap justify-between gap-2 text-[9pt] text-text-muted">
            <span>문서 번호 {m.reportNumber}</span>
            <span>발행 {formatSeoulTime(Date.parse(m.generatedAt)).slice(0, 19)} (Asia/Seoul)</span>
          </div>
          <h1 className="m-0 text-[18pt] font-bold">디지털 증거 무결성 검증 확인서</h1>
          <p className="m-0 text-[9pt] text-text-muted">
            검증 기관 {ISSUER} · 제출처: 국립과학수사연구원·경찰·법원·손해보험사
          </p>
        </header>

        <Stamp report={report} />

        <div className="grid gap-1">
          <h2 className="m-0 text-[11pt] font-bold">1. 대상 차량 및 단말</h2>
          <div className="overflow-x-auto pr-px pb-px print:overflow-visible">
            <table className="w-full border-collapse text-[9pt]">
              <tbody>
                <tr>
                  <th className={th}>소속</th>
                  <td className={td}>{m.organizationName}</td>
                  <th className={th}>차량 등록번호</th>
                  <td className={td} data-report-plate>{m.plateNumber}</td>
                </tr>
                <tr>
                  <th className={th}>차종</th>
                  <td className={td}>{m.modelName}</td>
                  <th className={th}>차대번호(마스킹)</th>
                  <td className={`${td} font-mono`}>{m.vinMasked ?? "미등록"}</td>
                </tr>
                <tr>
                  <th className={th}>단말 일련번호</th>
                  <td className={`${td} font-mono font-semibold`} data-report-serial>{m.deviceSerialNumber}</td>
                  <th className={th}>하드웨어/펌웨어</th>
                  <td className={td}>
                    {m.hardwareRev} / {m.firmwareVersion}
                  </td>
                </tr>
                <tr>
                  <th className={th}>보정 가동 거리</th>
                  <td className={td} colSpan={3}>
                    가속 {m.accelStrokeMm.toFixed(2)}mm · 제동 {m.brakeStrokeMm.toFixed(2)}mm (ToF 0.01mm 해상도)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-1">
          <h2 className="m-0 text-[11pt] font-bold">2. 사고 이벤트 개요</h2>
          <div className="overflow-x-auto pr-px pb-px print:overflow-visible">
            <table className="w-full border-collapse text-[9pt]">
              <tbody>
                <tr>
                  <th className={th}>발화 유형</th>
                  <td className={td}>{TRIGGER_LABELS[report.triggerType]}</td>
                  <th className={th}>발화 시점(T=0)</th>
                  <td className={`${td} tabular-nums`}>{formatSeoulTime(report.triggerTimeMs)}</td>
                </tr>
                <tr>
                  <th className={th}>기록 구간</th>
                  <td className={`${td} tabular-nums`} colSpan={3} data-report-range>
                    {formatSeoulTime(Date.parse(report.startTime))} ~ {formatSeoulTime(Date.parse(report.endTime))} (총 {s.totalDurationSeconds}초: 발화 전·후 각 30초)
                  </td>
                </tr>
                <tr>
                  <th className={th}>기록 패킷 수</th>
                  <td className={td}>{v.totalRecords.toLocaleString("ko-KR")}개 (64바이트 고정 레코드)</td>
                  <th className={th}>검증 소요</th>
                  <td className={td}>{v.verificationDurationMs}ms</td>
                </tr>
                <tr>
                  <th className={th}>시작 해시(제네시스)</th>
                  <td className={`${td} font-mono text-[8pt] break-all`} colSpan={3} data-report-initial-hash>
                    {v.initialHash}
                  </td>
                </tr>
                <tr>
                  <th className={th}>최종 해시</th>
                  <td className={`${td} font-mono text-[8pt] break-all`} colSpan={3} data-report-final-hash>
                    {v.finalHash || "변조로 계산 중단"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-1">
          <h2 className="m-0 text-[11pt] font-bold">3. 핵심 거동 통계</h2>
          <dl className="m-0 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              ["최대 가속 페달 답력", `${s.maxAccelPercent}%`],
              ["최대 제동 페달 답력", `${s.maxBrakePercent}%`],
              ["양발 동시 답입 지속", `${s.dualPressDurationSeconds}초`],
            ].map(([label, value]) => (
              <div key={label} className="grid gap-0.5 rounded-md border border-border-strong p-2">
                <dt className="text-[8pt] text-text-muted">{label}</dt>
                <dd className="m-0 text-[14pt] font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {tampered ? (
            <p className="m-0 text-[8pt] font-semibold text-critical">
              ※ 변조가 감지된 파일을 그대로 읽은 값입니다. 범위를 벗어난 값(예: 100% 초과)을 포함할 수 있으며 신뢰할 수 없습니다.
            </p>
          ) : null}
        </div>

        <PageFooter page={1} />
      </section>

      {/* 2쪽: 그래프·감사표·서명 */}
      <section className="report-page relative flex flex-col gap-4 overflow-hidden rounded-lg bg-bg-base p-5 shadow-lg sm:p-8 print:break-before-page print:rounded-none print:p-0 print:shadow-none">
        {tampered ? <Watermark /> : null}
        <div className="grid gap-2">
          <h2 className="m-0 text-[11pt] font-bold">4. 페달 조작 시계열 궤적 (발화 전후 60초)</h2>
          <VectorChartLegend />
          <ForensicVectorChart report={report} />
        </div>

        <div className="grid gap-1">
          <h2 className="m-0 text-[11pt] font-bold">5. 해시 체인 감사표 (시작 3 · 트리거 전후 5 · 종료 3)</h2>
          <div className="overflow-x-auto pr-px pb-px print:overflow-visible">
            <table className="w-full min-w-[520px] border-collapse text-[8pt] tabular-nums" data-report-ledger>
              <thead>
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>시각(서울)</th>
                  <th className={th}>가속/제동</th>
                  <th className={th}>직전 해시</th>
                  <th className={th}>패킷 해시</th>
                </tr>
              </thead>
              <tbody>
                {report.auditLedgerSample.map((p) => (
                  <tr key={p.sequenceId} className={p.timestampUtc === report.triggerTimeMs ? "font-bold" : undefined}>
                    <td className={td}>{p.sequenceId}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatSeoulTime(p.timestampUtc).slice(11)}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      {p.accelPercent}% / {p.brakePercent}%
                    </td>
                    <td className={`${td} font-mono`}>{mid(p.prevRecordHash)}</td>
                    <td className={`${td} font-mono`}>{mid(p.calculatedHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 text-[8pt] text-text-muted">굵은 행은 트리거 시점. 각 행의 &lsquo;직전 해시&rsquo;는 바로 앞 패킷의 &lsquo;패킷 해시&rsquo;와 같아야 합니다.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-2 text-[9pt]">
            <h2 className="m-0 text-[11pt] font-bold">6. 확인</h2>
            <p className="m-0">위 기록의 해시 체인을 전수 재계산하여 그 결과를 이 문서에 기재하였음을 확인합니다.</p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <span className="border-b border-text-main pb-5">검증 담당자: (서명)</span>
              <span className="border-b border-text-main pb-5">확인 일자:</span>
            </div>
          </div>
          <figure className="m-0 grid justify-items-center gap-1">
            <div className="size-[28mm] [&_svg]:size-full" aria-label="검증 페이지 QR 코드" role="img" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <figcaption className="max-w-[40mm] text-center text-[7pt] break-all text-text-muted">{verifyUrl}</figcaption>
          </figure>
        </div>

        <PageFooter page={2} />
      </section>
    </div>
  );
}

function Watermark() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
      <span className="-rotate-[30deg] text-center text-[26pt] font-bold whitespace-nowrap text-critical/15">
        무결성 훼손(변조 감지)
        <br />
        증거 능력 상실
      </span>
    </div>
  );
}
