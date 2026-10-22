import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

/**
 * Trusted server-only Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 * NEVER import this module into Client Components.
 * Used exclusively for:
 * - Encrypted OAuth token persistence in `email_connections`
 * - Scheduled Vercel Cron execution across opted-in users
 * - Server-side audit logging (`email_logs`, `automation_runs`, `ai_generation_logs`)
 * - Full user account cascade deletion on explicit user request
 */
export function createAdminSupabaseClient() {
  const { supabaseUrl } = getPublicEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for privileged server operations."
    );
  }

  return createSupabaseJsClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
