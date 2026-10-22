import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";

const AutomationSettingsSchema = z.object({
  is_enabled: z.boolean(),
  schedule_cron: z.string().max(40).optional().default("0 7 * * *"),
  search_locations: z.array(z.string().max(60)).max(12),
  preferred_sectors: z.array(z.string().max(80)).max(15),
  search_keywords: z.array(z.string().max(80)).max(15).optional().default([]),
  include_remote: z.boolean().default(true),
  min_match_score: z.number().min(0).max(100),
  max_opportunities_per_run: z.number().min(1).max(50),
  auto_generate_drafts: z.boolean().default(true),
  max_drafts_per_run: z.number().min(0).max(10).default(3),
  ai_provider: z.enum(["groq", "gemini", "xai"]),
  fallback_ai_provider: z
    .enum(["groq", "gemini", "xai"])
    .nullable()
    .optional(),
  email_language: z.enum(["auto", "fr", "en"]),
  notify_in_app: z.boolean().default(true),
  notify_email: z.boolean().default(false),
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
      .upsert({ user_id: user.id }, { onConflict: "user_id" })
      .select("*")
      .single();
    settings = created;
  }

  const { data: runs } = await supabase
    .from("automation_runs")
    .select("*")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(25);

  return NextResponse.json({
    settings,
    runs: runs ?? [],
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    const body = AutomationSettingsSchema.parse(await request.json());
    const nextRun = body.is_enabled
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : null;

    const { data, error } = await supabase
      .from("automation_settings")
      .upsert(
        {
          user_id: user.id,
          ...body,
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
            : "Invalid automation configuration.",
      },
      { status: 400 }
    );
  }
}
