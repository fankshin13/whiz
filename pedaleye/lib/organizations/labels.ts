import type { Database } from "@/lib/supabase/database.types";

export type OrganizationType = Database["public"]["Enums"]["organization_type"];

export const ORGANIZATION_TYPE_LABELS: Record<OrganizationType, string> = {
  b2g: "지자체(B2G)",
  fleet: "운수사(플릿)",
  standard: "일반",
};
