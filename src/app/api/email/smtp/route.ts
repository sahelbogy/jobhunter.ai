import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getServerEnvStatus } from "@/lib/env";

const SmtpConnectSchema = z.object({
  daily_send_limit: z.number().min(1).max(100).optional().default(25),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const envStatus = getServerEnvStatus();
  if (!envStatus.smtpConfigured) {
    return NextResponse.json(
      {
        error:
          "Server SMTP environment variables (SMTP_HOST, SMTP_USER, SMTP_PASS) are not configured.",
        requiresConfiguration: true,
      },
      { status: 422 }
    );
  }

  try {
    const body = SmtpConnectSchema.parse(await request.json().catch(() => ({})));
    const senderEmail =
      process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || "";

    const admin = createAdminSupabaseClient();
    const { data, error } = await admin
      .from("email_connections")
      .upsert(
        {
          user_id: user.id,
          provider: "smtp",
          email_address: senderEmail,
          scopes: ["smtp.send"],
          is_active: true,
          daily_send_limit: body.daily_send_limit,
          last_connected_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: "user_id" }
      )
      .select(
        "id, provider, email_address, is_active, daily_send_limit, sends_today, last_connected_at"
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ connection: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to enable SMTP." },
      { status: 400 }
    );
  }
}
