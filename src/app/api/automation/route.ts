import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { validateRecipientEmail } from "@/lib/security/sanitize";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const AutomationSettingsSchema = z.object({
  is_enabled: z.boolean(),
  schedule_cron: z.string().max(40).optional().default("0 7 * * *"),
  schedule_mode: z
    .enum(["daily", "specific_date", "manual_only"])
    .optional()
    .default("daily"),
  scheduled_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  search_locations: z.array(z.string().max(60)).max(12),
  preferred_sectors: z.array(z.string().max(80)).max(15),
  search_keywords: z.array(z.string().max(80)).max(15).optional().default([]),
  include_remote: z.boolean().default(true),
  min_match_score: z.number().min(0).max(100),
  max_opportunities_per_run: z.number().min(1).max(50),
  auto_generate_drafts: z.boolean().default(true),
  max_drafts_per_run: z.number().min(0).max(10).default(5),
  ai_provider: z.enum(["groq", "gemini", "xai"]),
  fallback_ai_provider: z
    .enum(["groq", "gemini", "xai"])
    .nullable()
    .optional(),
  email_language: z.enum(["auto", "fr", "en"]),
  notify_in_app: z.boolean().default(true),
  notify_email: z.boolean().default(true),
  email_approval_enabled: z.boolean().optional().default(true),
  approval_email_recipient: z.string().max(180).optional().default(""),
  auto_send_on_email_approval: z.boolean().optional().default(true),
});

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  let { data: settings } = await supabase
    .from("automation_settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!settings) {
    const { data: created } = await supabase
      .from("automation_settings")
      .upsert(
        {
          user_id: user.id,
          approval_email_recipient: user.email ?? "",
        },
        { onConflict: "user_id" }
      )
      .select("*")
      .single();
    settings = created;
  }

  const admin = createAdminSupabaseClient();
  const [{ data: runs }, { data: emailApprovals }, { data: emailConnection }] =
    await Promise.all([
      supabase
        .from("automation_runs")
        .select("*")
        .eq("user_id", user.id)
        .order("started_at", { ascending: false })
        .limit(25),
      supabase
        .from("email_approval_requests")
        .select(
          "id, application_id, approval_code, approver_email, email_message_id, status, expires_at, responded_at, created_at"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(15),
      admin
        .from("email_connections")
        .select("provider, email_address, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

  return NextResponse.json({
    settings,
    runs: runs ?? [],
    emailApprovals: emailApprovals ?? [],
    emailConnection: emailConnection ?? null,
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    const body = AutomationSettingsSchema.parse(await request.json());

    let cleanedEmail = body.approval_email_recipient?.trim() || "";
    if (cleanedEmail) {
      const check = validateRecipientEmail(cleanedEmail);
      if (!check.valid) {
        return NextResponse.json(
          {
            error:
              "Entrez une adresse email de validation valide (ex: votre adresse Gmail).",
          },
          { status: 400 }
        );
      }
      cleanedEmail = check.normalized;
    }

    if (
      body.is_enabled &&
      body.schedule_mode === "specific_date" &&
      !body.scheduled_date
    ) {
      return NextResponse.json(
        {
          error:
            "Select the target date (YYYY-MM-DD) when choosing 'Specific Day' automation.",
        },
        { status: 400 }
      );
    }

    const nextRun = !body.is_enabled
      ? null
      : body.schedule_mode === "specific_date" && body.scheduled_date
        ? new Date(`${body.scheduled_date}T07:00:00.000Z`).toISOString()
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("automation_settings")
      .upsert(
        {
          user_id: user.id,
          ...body,
          scheduled_date: body.scheduled_date ?? null,
          approval_email_recipient: cleanedEmail,
          fallback_ai_provider: body.fallback_ai_provider ?? null,
          next_run_at: nextRun,
        },
        { onConflict: "user_id" }
      )
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ settings: data });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to save automation settings.",
      },
      { status: 400 }
    );
  }
}
