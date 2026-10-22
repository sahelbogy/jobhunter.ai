import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { disconnectEmailAccount } from "@/lib/email/gmail-oauth";
import { getServerEnvStatus } from "@/lib/env";

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const admin = createAdminSupabaseClient();
  // Select ONLY non-sensitive metadata columns; encrypted tokens NEVER leave the server
  const { data: connection } = await admin
    .from("email_connections")
    .select(
      "id, provider, email_address, scopes, is_active, daily_send_limit, sends_today, quota_reset_date, last_connected_at, last_error"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: logs } = await supabase
    .from("email_logs")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const envStatus = getServerEnvStatus();

  return NextResponse.json({
    connection: connection ?? null,
    logs: logs ?? [],
    oauthConfigured: envStatus.gmailOAuthConfigured,
    smtpConfigured: envStatus.smtpConfigured,
    tokenEncryptionConfigured: envStatus.tokenEncryptionConfigured,
  });
}

export async function DELETE() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  try {
    await disconnectEmailAccount(user.id);
    return NextResponse.json({ disconnected: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to disconnect email account.",
      },
      { status: 500 }
    );
  }
}
