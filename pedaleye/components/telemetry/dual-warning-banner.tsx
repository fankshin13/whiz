import { AlertOctagon } from "lucide-react";

export function DualWarningBanner() {
  return (
    <p role="alert" className="m-0 flex items-center gap-3 rounded-md bg-dual-warning px-4 py-3 text-h2 font-bold text-text-main">
      <AlertOctagon aria-hidden="true" size={24} className="led-flash shrink-0" />
      양발 동시 조작 경고: 페달 위치를 확인하십시오!
    </p>
  );
}
