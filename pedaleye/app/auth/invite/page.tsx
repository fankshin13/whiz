import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "초대 수락 | 페달아이" };

// 1회용 초대 링크 검증·비밀번호 설정은 '초대 링크 기반 플릿 사용자 온보딩' 작업에서 연결한다.
export default function InvitePage() {
  return (
    <>
      <div className="grid gap-2">
        <h1 className="m-0 text-h1 font-bold">초대 수락</h1>
        <p className="m-0 text-text-muted">
          관리자에게 받은 1회용 초대 링크로 계정을 활성화하고 비밀번호를 설정합니다.
        </p>
      </div>
      <div className="card grid gap-4">
        <p className="m-0">
          초대 수락 기능을 준비 중입니다. 이미 계정이 있다면 로그인 화면을 이용해 주세요.
        </p>
        <button type="button" className="btn" disabled aria-describedby="invite-note">
          초대 수락 및 비밀번호 설정
        </button>
        <span id="invite-note" className="text-caption text-text-muted">
          준비 중인 기능입니다
        </span>
        <Link href="/auth/login" className="btn btn-secondary">
          로그인 화면으로 이동
        </Link>
      </div>
    </>
  );
}
