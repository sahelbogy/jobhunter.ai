import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

export function createClient() {
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Supabase public configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)."
    );
  }
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
