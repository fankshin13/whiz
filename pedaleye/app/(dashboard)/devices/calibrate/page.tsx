import { Bluetooth, Play } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/page/empty-state";
import { PageHeader } from "@/components/page/page-header";
import { PendingAction } from "@/components/page/pending-action";
import { Section } from "@/components/page/section";
import { requireUserForPath } from "@/lib/auth/get-current-user";

export const metadata: Metadata = { title: "페달 캘리브레이션 | 페달아이" };

const STEPS = [
  { title: "영점 설정", body: "두 페달에서 발을 떼고 3초간 유지합니다(0%)." },
  { title: "최대 답입 설정", body: "가속·제동 페달을 각각 끝까지 밟아 3초간 유지합니다(100%)." },
  { title: "확인 및 저장", body: "LED 레벨미터가 5단계로 정상 점등되는지 확인한 뒤 저장합니다." },
];

export default async function CalibratePage() {
  await requireUserForPath("/devices/calibrate");

  return (
    <>
      <PageHeader
        title="페달 캘리브레이션"
        description="ToF 센서 거리값을 차량 페달 가동 범위에 맞춰 보정합니다."
        action={
          <PendingAction id="start-zero">
            <Play aria-hidden="true" size={18} />
            페달 영점(0%) 설정 시작
          </PendingAction>
        }
      />
      <Section id="steps-heading" title="보정 절차">
        <ol className="m-0 grid list-none gap-3 p-0">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3 rounded-md border border-border bg-bg-base p-4">
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-md bg-primary-action font-bold text-primary-action-fg"
              >
                {index + 1}
              </span>
              <div className="grid gap-1">
                <strong>
                  <span className="sr-only">{index + 1}단계: </span>
                  {step.title}
                </strong>
                <span className="text-text-muted">{step.body}</span>
              </div>
            </li>
          ))}
        </ol>
      </Section>
      <Section id="sensor-heading" title="센서 연결">
        <EmptyState icon={Bluetooth} title="BLE 센서 연결 기능을 준비 중입니다.">
          연결되면 현재 가속·제동 페달 거리값(0.01mm 단위)이 실시간으로 표시됩니다.
        </EmptyState>
      </Section>
    </>
  );
}
