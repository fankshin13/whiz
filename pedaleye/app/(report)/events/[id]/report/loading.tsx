export default function ReportLoading() {
  return (
    <div className="mx-auto grid w-full max-w-[210mm] gap-4" role="status" aria-label="포렌식 검증 보고서 생성 중">
      <div className="flex justify-end">
        <button type="button" className="btn" disabled>
          <span className="spinner" aria-hidden="true" />
          A4 인쇄 / PDF 저장
        </button>
      </div>
      <div className="grid gap-4 rounded-lg bg-bg-base p-8 shadow-lg">
        <p className="m-0 font-semibold">포렌식 검증 보고서 생성 중...</p>
        {[40, 90, 70, 100, 60].map((w) => (
          <div key={w} className="h-5 rounded-md bg-border motion-safe:animate-pulse" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
