import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import {
  analyzeJobMatchWithAi,
  calculateDeterministicJobMatch,
} from "@/lib/matching/engine";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { AiProviderId, UserProfile } from "@/types/domain";

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { searchParams } = new URL(request.url);
  const minScore = Number(searchParams.get("minScore") ?? 0);

  const { data, error } = await supabase
    .from("job_matches")
    .select(
      `
      *,
      job:jobs (*)
    `
    )
    .eq("user_id", user.id)
    .gte("match_score", minScore)
    .order("match_score", { ascending: false })
    .limit(150);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ matches: data ?? [] });
}

const MatchActionSchema = z.object({
  mode: z.enum(["rescore_all", "ai_deep_match"]),
  jobId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    const body = MatchActionSchema.parse(await request.json());

    const [{ data: profile }, { data: prefs }, { data: activeResume }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase
          .from("user_preferences")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("resumes")
          .select("id")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle(),
      ]);

    const userProfile = (profile ?? {}) as Partial<UserProfile>;

    if (body.mode === "ai_deep_match") {
      if (!body.jobId) {
        return NextResponse.json(
          { error: "jobId is required for ai_deep_match." },
          { status: 400 }
        );
      }

      const { data: job } = await supabase
        .from("jobs")
        .select("*")
        .eq("id", body.jobId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!job) {
        return NextResponse.json({ error: "Job not found." }, { status: 404 });
      }

      const admin = createAdminSupabaseClient();
      const analysis = await analyzeJobMatchWithAi({
        profile: userProfile,
        job,
        targetLocations: prefs?.target_locations,
        preferredSectors: prefs?.preferred_sectors,
        routing: {
          primaryProvider: (prefs?.primary_ai_provider ??
            "groq") as AiProviderId,
          primaryModel: prefs?.primary_ai_model ?? null,
          fallbackProvider: (prefs?.fallback_ai_provider ??
            null) as AiProviderId | null,
          fallbackModel: prefs?.fallback_ai_model ?? null,
          allowPaidFallback: Boolean(prefs?.allow_paid_fallback),
          userId: user.id,
        },
        onLog: async (entry) => {
          await admin.from("ai_generation_logs").insert({
            user_id: user.id,
            ...entry,
          });
        },
      });

      const { data: savedMatch, error: upErr } = await supabase
        .from("job_matches")
        .upsert(
          {
            user_id: user.id,
            job_id: job.id,
            resume_id: activeResume?.id ?? null,
            match_score: analysis.match_score,
            score_breakdown: analysis.score_breakdown,
            matching_skills: analysis.matching_skills,
            missing_skills: analysis.missing_skills,
            strengths: analysis.strengths,
            weaknesses: analysis.weaknesses,
            recommendation: analysis.recommendation,
            explanation: analysis.explanation,
            scoring_method: analysis.scoring_method,
            ai_provider: analysis.ai_provider ?? null,
            ai_model: analysis.ai_model ?? null,
          },
          { onConflict: "user_id,job_id" }
        )
        .select("*, job:jobs(*)")
        .single();

      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 500 });
      }

      return NextResponse.json({ match: savedMatch });
    }

    // rescore_all mode
    const { data: allJobs } = await supabase
      .from("jobs")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .limit(200);

    if (!allJobs || allJobs.length === 0) {
      return NextResponse.json({ updatedCount: 0 });
    }

    const rows = allJobs.map((job) => {
      const m = calculateDeterministicJobMatch({
        profile: userProfile,
        job,
        targetLocations: prefs?.target_locations,
        preferredSectors: prefs?.preferred_sectors,
      });
      return {
        user_id: user.id,
        job_id: job.id,
        resume_id: activeResume?.id ?? null,
        match_score: m.match_score,
        score_breakdown: m.score_breakdown,
        matching_skills: m.matching_skills,
        missing_skills: m.missing_skills,
        strengths: m.strengths,
        weaknesses: m.weaknesses,
        recommendation: m.recommendation,
        explanation: m.explanation,
        scoring_method: "deterministic",
      };
    });

    const { error: batchErr } = await supabase
      .from("job_matches")
      .upsert(rows, { onConflict: "user_id,job_id" });

    if (batchErr) {
      return NextResponse.json({ error: batchErr.message }, { status: 500 });
    }

    return NextResponse.json({ updatedCount: rows.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Matching failed." },
      { status: 400 }
    );
  }
}
