import { redirect } from "next/navigation";

import { getCurrentUser, isDeactivatedSession } from "@/lib/auth/get-current-user";
import { homePathForRole } from "@/lib/auth/roles";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user && (await isDeactivatedSession())) redirect("/auth/deactivated");
  redirect(user ? homePathForRole(user.role) : "/auth/login");
}
