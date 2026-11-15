"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/get-current-user";
import { uploadEventSession, type UploadSessionResult } from "@/lib/events/upload";
import { createAdminClient } from "@/lib/server/supabase-admin";
import { createClient } from "@/lib/supabase/server";

export async function uploadEventSessionAction(input: unknown): Promise<UploadSessionResult | { success: false; status: 401; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, status: 401, error: "로그인이 필요합니다. 다시 로그인해 주세요." };

  const result = await uploadEventSession(await createClient(), createAdminClient(), user, input);
  if (result.success && !result.duplicate) {
    revalidatePath("/events");
    revalidatePath("/dashboard");
  }
  return result;
}
