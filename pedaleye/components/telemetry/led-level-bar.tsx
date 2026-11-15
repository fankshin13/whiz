import type { TelemetryFrame } from "@/lib/telemetry/types";

/** 대시보드 USB LED 레벨미터 화면 표시. 가속 청색·제동 적색 5칸, 양발 동시 조작은 전체 주황 점멸. */
export function LedLevelBar({ frame }: { frame: TelemetryFrame | null }) {
  const mode = frame?.mode ?? "IDLE";
  const lit = mode === "ACCEL" ? frame?.accelLevel ?? 0 : mode === "BRAKE" ? frame?.brakeLevel ?? 0 : mode === "DUAL_WARNING" ? 5 : 0;
  const color = mode === "ACCEL" ? "bg-accel" : mode === "BRAKE" ? "bg-brake" : "bg-dual-warning led-flash";
  const label =
    mode === "ACCEL"
      ? `가속 ${frame?.accelLevel}단계`
      : mode === "BRAKE"
        ? `제동 ${frame?.brakeLevel}단계`
        : mode === "DUAL_WARNING"
          ? "동시 답입"
          : "대기";

  return (
    <div className="grid gap-2" data-led-mode={mode} data-led-lit={lit}>
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">LED 레벨미터</span>
        <span className="font-bold" aria-live="off">
          {label}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-1 rounded-md bg-primary-action p-2" role="img" aria-label={`LED 레벨미터: ${label}`}>
        {[1, 2, 3, 4, 5].map((segment) => (
          <span
            key={segment}
            className={`h-6 rounded-sm ${segment <= lit ? color : "bg-text-muted/40"}`}
            data-lit={segment <= lit}
          />
        ))}
      </div>
    </div>
  );
}
