import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { runJobDiscoveryForUser } from "@/lib/jobs/discovery";
import type { UserProfile } from "@/types/domain";

const DiscoverBodySchema = z.object({
  query: z.string().max(150).optional(),
  locations: z.array(z.string().max(60)).max(10).optional(),
  sector: z.string().max(80).optional(),
  remotePreference: z
    .enum(["any", "remote_only", "hybrid", "onsite"])
    .optional(),
  contractType: z.string().max(40).optional(),
  language: z.enum(["any", "fr", "en"]).optional(),
  minSalary: z.number().min(0).nullable().optional(),
  limit: z.number().min(5).max(60).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const rl = checkRateLimit(`discover:${user.id}`, 10, 5 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Job discovery rate limit reached. Try again in ${rl.retryAfterSeconds}s.`,
      },
      { status: 429 }
    );
  }

  try {
    const raw = await request.json().catch(() => ({}));
    const filters = DiscoverBodySchema.parse(raw);

    const [{ data: profile }, { data: activeResume }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase
        .from("resumes")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
    ]);

    const summary = await runJobDiscoveryForUser({
      supabase,
      userId: user.id,
      profile: (profile ?? {}) as Partial<UserProfile>,
      filters,
      activeResumeId: activeResume?.id ?? null,
    });

    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Job discovery failed.",
      },
      { status: 500 }
    );
  }
}
