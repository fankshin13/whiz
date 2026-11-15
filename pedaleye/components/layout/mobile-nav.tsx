"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import { NavLinks } from "@/components/navigation/nav-links";
import type { NavItem } from "@/components/navigation/nav-config";

import { Brand } from "./brand";

/** 1024px 미만: 상단 56px 헤더 + 햄버거로 여는 좌측 드로어(ESC·바깥 터치로 닫힘). */
export function MobileNav({ items, footer }: { items: NavItem[]; footer: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  const close = () => dialogRef.current?.close();

  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  return (
    <header className="sticky top-0 z-10 flex h-(--size-header) items-center justify-between border-b border-border bg-bg-base px-4 lg:hidden">
      <Brand />
      <button
        type="button"
        className="btn btn-secondary px-0"
        aria-label="메뉴 열기"
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
      >
        <Menu aria-hidden="true" size={22} />
      </button>

      <dialog
        ref={dialogRef}
        className="drawer"
        aria-label="주 메뉴"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-(--size-header) items-center justify-between border-b border-border px-4">
            <Brand />
            <button type="button" className="btn btn-secondary px-0" aria-label="메뉴 닫기" onClick={close}>
              <X aria-hidden="true" size={22} />
            </button>
          </div>
          <nav aria-label="주 메뉴" className="flex-1 overflow-y-auto p-4">
            <NavLinks items={items} onNavigate={close} />
          </nav>
          <div className="grid gap-3 border-t border-border p-4">{footer}</div>
        </div>
      </dialog>
    </header>
  );
}
