import { isFactoryCalibration } from "@/lib/calibration/operations";
import { formatMillimeters } from "@/lib/telemetry/displacement-engine";
import type { DeviceCalibrationData } from "@/types/calibration";

/** 단말에 지금 저장된 보정값. 모바일 앱에서 보정한 값도 여기서 같은 숫자로 보인다. */
export function CurrentCalibration({ device }: { device: DeviceCalibrationData }) {
  if (isFactoryCalibration(device)) {
    return (
      <p className="m-0 text-text-muted">
        아직 보정 전입니다(공장 기본값). 아래 4단계를 마치면 보정값이 저장됩니다.
      </p>
    );
  }
  const rows = [
    { label: "가속 0% (유휴)", name: "accel_calib_max", value: device.accelCalibMax },
    { label: "가속 100% (완전 답입)", name: "accel_calib_min", value: device.accelCalibMin },
    { label: "제동 0% (유휴)", name: "brake_calib_max", value: device.brakeCalibMax },
    { label: "제동 100% (완전 답입)", name: "brake_calib_min", value: device.brakeCalibMin },
  ];
  return (
    <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {rows.map((row) => (
        <div key={row.name} className="grid gap-0.5" data-calibration={row.name}>
          <dt className="text-caption text-text-muted">{row.label}</dt>
          <dd className="m-0 font-semibold tabular-nums">{formatMillimeters(row.value)}mm</dd>
        </div>
      ))}
    </dl>
  );
}
