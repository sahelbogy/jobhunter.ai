import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim().toLowerCase() ?? "";
  const source = searchParams.get("source") ?? "all";
  const remote = searchParams.get("remote") ?? "all";
  const lang = searchParams.get("language") ?? "all";
  const savedOnly = searchParams.get("saved") === "true";
  const minScore = Number(searchParams.get("minScore") ?? 0);

  let query = supabase
    .from("jobs")
    .select(
      `
      *,
      job_matches (
        id,
        match_score,
        score_breakdown,
        matching_skills,
        missing_skills,
        strengths,
        weaknesses,
        recommendation,
        explanation,
        scoring_method
      )
    `
    )
    .eq("user_id", user.id)
    .eq("is_archived", false)
    .order("discovered_at", { ascending: false })
    .limit(150);

  if (source !== "all") {
    query = query.eq("source", source);
  }
  if (remote === "true") {
    query = query.eq("is_remote", true);
  }
  if (lang === "fr" || lang === "en") {
    query = query.eq("detected_language", lang);
  }
  if (savedOnly) {
    query = query.eq("is_saved", true);
  }

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const jobs = (rows ?? [])
    .map((r: any) => {
      const match = Array.isArray(r.job_matches)
        ? r.job_matches[0] ?? null
        : r.job_matches ?? null;
      const { job_matches: _unused, ...rest } = r;
      return { ...rest, match };
    })
    .filter((job) => {
      if (minScore > 0 && (job.match?.match_score ?? 0) < minScore) {
        return false;
      }
      if (q) {
        const hay =
          `${job.title} ${job.company_name} ${job.location} ${job.sector} ${(
            job.required_skills ?? []
          ).join(" ")}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    })
    .sort((a, b) => (b.match?.match_score ?? 0) - (a.match?.match_score ?? 0));

  return NextResponse.json({ jobs });
}

const PatchJobSchema = z.object({
  id: z.string().uuid(),
  is_saved: z.boolean().optional(),
  is_archived: z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    const body = PatchJobSchema.parse(await request.json());
    const updates: Record<string, boolean> = {};
    if (typeof body.is_saved === "boolean") updates.is_saved = body.is_saved;
    if (typeof body.is_archived === "boolean")
      updates.is_archived = body.is_archived;

    const { data, error } = await supabase
      .from("jobs")
      .update(updates)
      .eq("id", body.id)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ job: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request" },
      { status: 400 }
    );
  }
}
