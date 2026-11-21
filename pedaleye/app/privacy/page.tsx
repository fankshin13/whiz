import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/layout/brand";
import { getPrivacyInfo } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return getPrivacyInfo()
    ? { title: "개인정보처리방침 | 페달아이" }
    : { title: "개인정보처리방침(준비 중) | 페달아이", robots: { index: false } };
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="border border-border bg-bg-panel p-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) => (
                <td key={i} className="border border-border p-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 공개 개인정보처리방침. 처리자·책임자·연락처·시행일은 환경 변수(PRIVACY_*)로 넣는다. */
export default function PrivacyPage() {
  const info = getPrivacyInfo();
  return (
    <main className="min-h-dvh bg-bg-panel px-4 py-8">
      <article className="mx-auto grid w-full max-w-3xl gap-6 rounded-lg border border-border bg-bg-base p-6">
        <Brand />
        <h1 className="m-0 text-h1 font-bold">개인정보처리방침</h1>
        {!info ? (
          <p className="alert m-0" role="status">
            개인정보처리방침을 준비 중입니다.
          </p>
        ) : (
          <Policy info={info} />
        )}
      </article>
    </main>
  );
}

function Policy({ info }: { info: NonNullable<ReturnType<typeof getPrivacyInfo>> }) {
  const h2 = "m-0 text-h2 font-semibold";
  return (
    <>
      <p className="m-0">
        {info.controller}(이하 &ldquo;회사&rdquo;)는 페달아이 서비스(운전자 앱·관리 웹)를 제공하면서 아래와 같이 개인정보를 처리합니다.
      </p>

      <section className="grid gap-2">
        <h2 className={h2}>1. 처리 목적</h2>
        <ul className="m-0 grid list-disc gap-1 pl-5">
          <li>회원 관리: 초대받은 사용자의 가입·로그인, 소속 기관·배정 차량 관리</li>
          <li>사고 기록 보전·입증: 페달 조작 기록의 저장, 무결성 검증, 사고 보고서 제공</li>
          <li>보안·감사: 관리 작업 기록, 부정 이용 방지</li>
        </ul>
      </section>

      <section className="grid gap-2">
        <h2 className={h2}>2. 처리 항목</h2>
        <Table
          head={["구분", "항목", "수집 방법"]}
          rows={[
            ["계정", "이름, 이메일, 비밀번호(일방향 암호화 저장), 소속 기관, 역할", "관리자의 초대, 사용자의 비밀번호 설정"],
            ["차량·단말", "배정 차량 번호, 단말 일련번호", "관리자 등록"],
            ["운행·사고 기록", "가속·제동 페달 조작값, 시각", "차량 단말이 기록하고 앱이 서버로 전송"],
            ["자동 생성", "접속 IP, 관리 작업 기록, 로그인 세션 쿠키(웹)", "서비스 이용 과정"],
          ]}
        />
        <p className="m-0">
          회사는 위치정보(GPS 위치·속도)를 수집하지 않으며, 휴대폰의 연락처·사진·광고 식별자도 수집하지 않습니다. 블루투스 권한은 차량 단말 연결에만
          쓰고, 안드로이드 11 이하의 위치 권한은 블루투스 기기 검색에 시스템이 요구해서만 요청하며 위치를 읽지 않습니다.
        </p>
      </section>

      <section className="grid gap-2">
        <h2 className={h2}>3. 보유 기간</h2>
        <Table
          head={["항목", "보유 기간"]}
          rows={[
            ["계정 정보", "계정 비활성화(삭제 요청 포함) 후 1년"],
            ["사고 기록", "기록 생성 후 3년(사고 분쟁의 증거 보전)"],
            ["관리 작업 기록(감사 로그)", "1년. 이후 비공개 저장소에 보관본을 남긴 뒤 삭제"],
          ]}
        />
      </section>

      <section className="grid gap-2">
        <h2 className={h2}>4. 제3자 제공</h2>
        <p className="m-0">
          회사는 개인정보를 제3자에게 제공하지 않습니다. 다만 사고 기록은 운전자가 소속된 기관의 관리자와 기관이 초대한 사고조사관이 열람할 수 있으며, 법령에
          따른 요청이 있으면 그에 따릅니다.
        </p>
      </section>

      <section className="grid gap-2">
        <h2 className={h2}>5. 처리 위탁</h2>
        <Table
          head={["수탁자", "위탁 업무", "저장 위치"]}
          rows={[
            ["Supabase Inc.", "데이터베이스·파일 저장, 로그인", "대한민국(서울 리전)"],
            ["Vercel Inc.", "웹·API 서버 운영", "대한민국(서울 리전)"],
          ]}
        />
      </section>

      <section className="grid gap-2">
        <h2 className={h2}>6. 파기</h2>
        <p className="m-0">보유 기간이 끝난 개인정보는 지체 없이 복구할 수 없는 방법으로 삭제합니다.</p>
      </section>

      <section className="grid gap-2">
        <h2 className={h2}>7. 정보주체의 권리</h2>
        <p className="m-0">
          열람·정정·삭제·처리정지를 요청할 수 있습니다. 계정 삭제는 앱 홈 화면의 &lsquo;계정 삭제 요청&rsquo; 또는{" "}
          <Link href="/account/delete" className="underline">계정 삭제 요청 페이지</Link>에서 바로 할 수 있으며, 그 밖의 요청은 아래 연락처로 보내 주시면 10일 안에 답합니다.
          사고 기록 등 다른 법령이나 분쟁 대응을 위해 보관해야 하는 정보는 삭제가 제한될 수 있습니다.
        </p>
      </section>

      <section className="grid gap-2">
        <h2 className={h2}>8. 안전성 확보 조치</h2>
        <p className="m-0">
          전송 구간 암호화(HTTPS), 비밀번호 일방향 암호화, 역할별 접근 통제, 관리 작업 감사 로그, 사고 기록의 해시 체인·단말 서명으로 위·변조를 막습니다.
        </p>
      </section>

      <section className="grid gap-2">
        <h2 className={h2}>9. 개인정보 보호책임자</h2>
        <p className="m-0">
          {info.officer} · {info.contact}
        </p>
      </section>

      <p className="m-0 text-text-muted">시행일: {info.effectiveDate}</p>
    </>
  );
}
