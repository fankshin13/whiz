import type { Metadata } from "next";
import Link from "next/link";

import { AuthLayout } from "@/components/layout/auth-layout";

import { DeletionForm } from "./deletion-form";

export const metadata: Metadata = { title: "계정 삭제 요청 | 페달아이" };

/** 공개 페이지: 앱을 지웠거나 앱을 쓸 수 없는 사용자도 계정 삭제를 요청할 수 있다(Play 정책). */
export default function AccountDeletePage() {
  return (
    <AuthLayout>
      <div className="grid gap-2">
        <h1 className="m-0 text-h1 font-bold">페달아이 계정 삭제 요청</h1>
        <p className="m-0 text-text-muted">본인 확인을 위해 페달아이 앱에서 쓰는 이메일과 비밀번호를 입력해 주세요.</p>
      </div>
      <ul className="m-0 grid list-disc gap-1 pl-5 text-text-muted">
        <li>요청 즉시 계정이 비활성화되어 앱과 웹에 로그인할 수 없고, 배정 차량에서 해제됩니다.</li>
        <li>계정 정보(이름·이메일)는 비활성화 후 1년, 사고 기록은 생성 후 3년 보관한 뒤 파기합니다. 사고 분쟁의 증거 보전을 위해서입니다.</li>
        <li>앱에서도 홈 화면의 &lsquo;계정 삭제 요청&rsquo;으로 같은 요청을 할 수 있습니다.</li>
      </ul>
      <DeletionForm />
      <p className="m-0 text-caption text-text-muted">
        자세한 내용은 <Link href="/privacy" className="underline">개인정보처리방침</Link>을 확인해 주세요.
      </p>
    </AuthLayout>
  );
}
