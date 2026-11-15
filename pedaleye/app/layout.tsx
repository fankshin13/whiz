import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import "./globals.css";

const pretendard = localFont({
  src: "../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

export const metadata: Metadata = {
  title: "페달아이",
  description: "페달 조작 무결성 기록 관리 콘솔",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body>{children}</body>
    </html>
  );
}
