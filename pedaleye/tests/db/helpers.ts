import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export const PASSWORD = "Pedaleye-Test-2026!";

export const ORG = {
  hwaseong: "10000000-0000-0000-0000-000000000001",
  seoul: "10000000-0000-0000-0000-000000000002",
} as const;

export const VEHICLE = {
  driverA: "30000000-0000-0000-0000-000000000001",
  driverB: "30000000-0000-0000-0000-000000000002",
  driverC: "30000000-0000-0000-0000-000000000003",
} as const;

export const USER = {
  driverA: "20000000-0000-0000-0000-000000000003",
  driverB: "20000000-0000-0000-0000-000000000004",
  driverC: "20000000-0000-0000-0000-000000000007",
} as const;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 이(가) 없습니다. 'supabase start' 후 .env.local 을 준비하세요.`);
  return value;
}

export function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function signedInClient(email: string): Promise<SupabaseClient<Database>> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${email} 로그인 실패: ${error.message}`);
  return client;
}
