import type { Pedal } from "@/lib/calibration/wizard";

const STYLE: Record<Pedal, { label: string; track: string; fill: string }> = {
  accel: { label: "가속", track: "bg-accel-bg", fill: "bg-accel" },
  brake: { label: "제동", track: "bg-brake-bg", fill: "bg-brake" },
};

/** 페달 답입률 게이지. 색과 함께 숫자·라벨로도 값을 알린다. */
export function PedalLiveGauge({ pedal, percent, level }: { pedal: Pedal; percent: number; level?: number }) {
  const { label, track, fill } = STYLE[pedal];
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">{label} 페달</span>
        <span className="flex items-baseline gap-2">
          {level !== undefined ? <span className="font-semibold text-text-muted">{level}단계</span> : null}
          <span className="text-metric font-bold tabular-nums">{percent}%</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${label} 페달 답입률`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className={`h-4 overflow-hidden rounded-md border border-border-strong ${track}`}
      >
        <div className={`h-full ${fill} transition-[width] duration-50 ease-linear motion-reduce:transition-none`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
