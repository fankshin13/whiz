import { LogOut } from "lucide-react";

import { logoutAction } from "@/app/auth/login/actions";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit" className="btn btn-secondary w-full">
        <LogOut aria-hidden="true" size={18} />
        로그아웃
      </button>
    </form>
  );
}
