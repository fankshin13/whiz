"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { postLoginPath } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null; email: string };

const INVALID_CREDENTIALS = "이메일 또는 비밀번호가 올바르지 않습니다. 다시 확인해 주세요.";
const TEMPORARY_FAILURE = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(72),
  redirectTo: z.string().max(512).optional(),
});

const DEACTIVATED_MESSAGE = "관리자에 의해 비활성화된 계정입니다. 소속 관리자에게 문의하세요.";
const DEACTIVATED = DEACTIVATED_MESSAGE;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").slice(0, 320);
  const fail = (error: string): LoginState => ({ error, email });

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });
  // 형식 오류도 같은 문구로 안내해 계정 존재 여부 등 정보를 노출하지 않는다.
  if (!parsed.success) return fail(INVALID_CREDENTIALS);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // 비활성화된 계정(Auth ban). 비밀번호가 맞을 때만 이 코드가 오므로 계정 존재 여부가 새지 않는다
    if (error.code === "user_banned") return fail(DEACTIVATED);
    if (error.code === "invalid_credentials" || error.status === 400) return fail(INVALID_CREDENTIALS);
    // 무차별 대입 방어: Supabase Auth 의 로그인 횟수 제한(config.toml auth.rate_limit)
    if (error.status === 429) return fail("로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.");
    console.error("login failed", { status: error.status, code: error.code });
    return fail(TEMPORARY_FAILURE);
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    console.error("login profile lookup failed", { code: profileError?.code ?? "missing_profile" });
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) console.error("signOut after profile failure failed", { status: signOutError.status });
    return fail(TEMPORARY_FAILURE);
  }

  if (!profile.is_active) {
    await supabase.auth.signOut({ scope: "local" });
    return fail(DEACTIVATED);
  }

  revalidatePath("/", "layout");
  redirect(postLoginPath(profile.role, parsed.data.redirectTo));
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("logout failed", { status: error.status });
    throw new Error("로그아웃에 실패했습니다.");
  }
  revalidatePath("/", "layout");
  redirect("/auth/login");
}
