import nodemailer from "nodemailer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { encryptSecret } from "@/lib/security/encryption";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getServerEnvStatus } from "@/lib/env";
import { inferDefaultSmtpHost } from "@/lib/email/transport";

const SmtpConnectSchema = z.object({
  email_address: z.string().email().max(180).optional(),
  app_password: z.string().max(240).optional(),
  smtp_host: z.string().max(180).optional(),
  smtp_port: z.number().int().min(1).max(65535).optional(),
  daily_send_limit: z.number().min(1).max(100).optional().default(25),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  try {
    const body = SmtpConnectSchema.parse(await request.json().catch(() => ({})));
    const admin = createAdminSupabaseClient();
    const envStatus = getServerEnvStatus();

    const userEmail = body.email_address?.trim().toLowerCase() || "";
    const rawPass = (body.app_password ?? "").replace(/\s+/g, "");

    // Mode A: User-supplied Gmail App Password / SMTP credentials (encrypted AES-256-GCM)
    if (userEmail && rawPass) {
      const inferred = inferDefaultSmtpHost(userEmail);
      const host = body.smtp_host?.trim() || inferred.host;
      const port = Number(body.smtp_port || inferred.port || 465);

      if (!host) {
        return NextResponse.json(
          {
            error:
              "Please specify your SMTP host (e.g. smtp.gmail.com for Gmail).",
          },
          { status: 400 }
        );
      }

      // Verify live SMTP authentication before saving
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
          user: userEmail,
          pass: rawPass,
        },
      });

      try {
        await transporter.verify();
      } catch (verifyErr) {
        return NextResponse.json(
          {
            error: `SMTP authentication failed (${host}:${port}): ${
              verifyErr instanceof Error
                ? verifyErr.message
                : "Check your Gmail App Password (16 characters)."
            }`,
          },
          { status: 400 }
        );
      }

      const encryptedPayload = encryptSecret(
        JSON.stringify({
          host,
          port,
          user: userEmail,
          pass: rawPass,
          from: userEmail,
        })
      );

      const { data, error } = await admin
        .from("email_connections")
        .upsert(
          {
            user_id: user.id,
            provider: "smtp",
            email_address: userEmail,
            encrypted_refresh_token: encryptedPayload,
            encrypted_access_token: null,
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

      return NextResponse.json({ connection: data, verified: true });
    }

    // Mode B: Server-configured SMTP environment variables
    if (!envStatus.smtpConfigured) {
      return NextResponse.json(
        {
          error:
            "Enter your email address and 16-character Gmail App Password (myaccount.google.com/apppasswords) to connect directly, or configure server SMTP variables.",
          requiresConfiguration: true,
        },
        { status: 422 }
      );
    }

    const senderEmail =
      process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || "";

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

    return NextResponse.json({ connection: data, verified: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to enable SMTP." },
      { status: 400 }
    );
  }
}
