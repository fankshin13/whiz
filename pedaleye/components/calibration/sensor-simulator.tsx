"use client";

import type { Pedal } from "@/lib/calibration/wizard";

const LABEL: Record<Pedal, string> = { accel: "가속 페달 밟은 정도", brake: "제동 페달 밟은 정도" };

/** 실제 단말 연결 전, 페달 조작을 흉내 내는 입력. 모바일 앱에서는 BLE 센서로 대체된다. */
export function SensorSimulator({
  values,
  onChange,
}: {
  values: Record<Pedal, number>;
  onChange: (pedal: Pedal, value: number) => void;
}) {
  return (
    <section aria-labelledby="simulator-heading" className="grid gap-3 rounded-lg border border-dashed border-border-strong bg-bg-base p-4">
      <div className="grid gap-1">
        <h2 id="simulator-heading" className="m-0 text-h2 font-semibold">
          센서 시뮬레이터
        </h2>
        <p className="m-0 text-caption text-text-muted">
          페달아이 단말이 연결되기 전까지 페달 조작을 흉내 냅니다. 실제 단말에서는 페달을 직접 밟으면 됩니다.
        </p>
      </div>
      {(["accel", "brake"] as const).map((pedal) => (
        <div key={pedal} className="grid gap-1">
          <label htmlFor={`sim-${pedal}`} className="flex justify-between font-semibold">
            <span>{LABEL[pedal]}</span>
            <output htmlFor={`sim-${pedal}`} className="tabular-nums">
              {values[pedal]}%
            </output>
          </label>
          <input
            id={`sim-${pedal}`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={values[pedal]}
            onChange={(event) => onChange(pedal, Number(event.currentTarget.value))}
            className={`h-(--size-touch) w-full ${pedal === "accel" ? "accent-accel" : "accent-brake"}`}
          />
        </div>
      ))}
    </section>
  );
}
