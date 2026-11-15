import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { homePathForRole } from "@/lib/auth/roles";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? homePathForRole(user.role) : "/auth/login");
}
