import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { testAiProviderConnection } from "@/lib/ai/orchestrator";
import { AiProviderError } from "@/lib/ai/types";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const TestSchema = z.object({
  provider: z.enum(["groq", "gemini", "xai"]),
  model: z.string().max(120).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const rl = checkRateLimit(`ai_test:${user.id}`, 12, 5 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Rate limit reached. Retry in ${rl.retryAfterSeconds}s.` },
      { status: 429 }
    );
  }

  try {
    const body = TestSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();

    const result = await testAiProviderConnection({
      provider: body.provider,
      model: body.model,
      onLog: async (entry) => {
        await admin.from("ai_generation_logs").insert({
          user_id: user.id,
          ...entry,
        });
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AiProviderError) {
      return NextResponse.json(
        {
          ok: false,
          provider: err.provider,
          code: err.code,
          error: err.message,
        },
        { status: err.code === "MISSING_CREDENTIALS" ? 422 : 400 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Connection test failed.",
      },
      { status: 500 }
    );
  }
}
