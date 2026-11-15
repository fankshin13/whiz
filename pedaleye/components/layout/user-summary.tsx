import { ROLE_LABELS, type UserRole } from "@/lib/auth/roles";

export type ShellUser = { name: string; email: string; role: UserRole };

export function UserSummary({ user }: { user: ShellUser }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="truncate font-semibold">{user.name}</span>
      <span className="truncate text-caption text-text-muted">
        {ROLE_LABELS[user.role]} · {user.email}
      </span>
    </div>
  );
}
