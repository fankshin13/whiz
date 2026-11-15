import { logoutAction } from "@/app/auth/login/actions";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit" className="button button-secondary">
        로그아웃
      </button>
    </form>
  );
}
