import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { getAiProvidersStatus } from "@/lib/ai/orchestrator";
import {
  deleteUserAiSecret,
  getUserAiSecretSummary,
  saveUserAiSecret,
} from "@/lib/ai/user-secrets";

const UpdateAiPrefsSchema = z.object({
  primary_ai_provider: z.enum(["groq", "gemini", "xai"]),
  primary_ai_model: z.string().min(2).max(120),
  fallback_ai_provider: z
    .enum(["groq", "gemini", "xai"])
    .nullable()
    .optional(),
  fallback_ai_model: z.string().max(120).nullable().optional(),
  allow_paid_fallback: z.boolean().optional().default(false),
});

const SaveAiKeySchema = z.object({
  provider: z.enum(["groq", "gemini", "xai"]),
  apiKey: z.string().max(400).optional().default(""),
});

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const [{ data: prefs }, { data: recentLogs }, userSecrets] =
    await Promise.all([
      supabase
        .from("user_preferences")
        .select(
          "primary_ai_provider, primary_ai_model, fallback_ai_provider, fallback_ai_model, allow_paid_fallback"
        )
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("ai_generation_logs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      getUserAiSecretSummary(user.id),
    ]);

  return NextResponse.json({
    providers: getAiProvidersStatus(userSecrets),
    preferences: prefs ?? {
      primary_ai_provider: "groq",
      primary_ai_model: "openai/gpt-oss-120b",
      fallback_ai_provider: "gemini",
      fallback_ai_model: "gemini-3.5-flash-lite",
      allow_paid_fallback: false,
    },
    recentLogs: recentLogs ?? [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  try {
    const body = SaveAiKeySchema.parse(await request.json());
    const trimmed = body.apiKey.trim();

    if (!trimmed) {
      await deleteUserAiSecret({
        userId: user.id,
        provider: body.provider,
      });
      const userSecrets = await getUserAiSecretSummary(user.id);
      return NextResponse.json({
        ok: true,
        removed: true,
        providers: getAiProvidersStatus(userSecrets),
      });
    }

    const saved = await saveUserAiSecret({
      userId: user.id,
      provider: body.provider,
      apiKey: trimmed,
    });
    const userSecrets = await getUserAiSecretSummary(user.id);

    return NextResponse.json({
      ok: true,
      keyHint: saved.keyHint,
      providers: getAiProvidersStatus(userSecrets),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not save encrypted provider API key.",
      },
      { status: 400 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    const body = UpdateAiPrefsSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: user.id,
          primary_ai_provider: body.primary_ai_provider,
          primary_ai_model: body.primary_ai_model,
          fallback_ai_provider: body.fallback_ai_provider ?? null,
          fallback_ai_model: body.fallback_ai_model ?? null,
          allow_paid_fallback: body.allow_paid_fallback,
        },
        { onConflict: "user_id" }
      )
      .select(
        "primary_ai_provider, primary_ai_model, fallback_ai_provider, fallback_ai_model, allow_paid_fallback"
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ preferences: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid AI settings." },
      { status: 400 }
    );
  }
}
