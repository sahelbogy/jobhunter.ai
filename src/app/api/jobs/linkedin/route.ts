import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import {
  buildImportedJobRecord,
  buildProfileMatchedLinkedInSearches,
  inspectPublicJobOfferUrl,
} from "@/lib/jobs/linkedin";
import {
  computeJobDedupHash,
  normalizeCompanyName,
} from "@/lib/jobs/dedup";
import { normalizeJobUrl } from "@/lib/security/sanitize";
import { calculateDeterministicJobMatch } from "@/lib/matching/engine";

const PreviewSchema = z.object({
  action: z.literal("preview_url"),
  url: z.string().url().max(1000),
});

const SingleOfferSchema = z.object({
  url: z.string().url().max(1000),
  title: z.string().min(2).max(200),
  company_name: z.string().min(1).max(160),
  location: z.string().min(2).max(160).default("Casablanca, Morocco"),
  description: z.string().max(15000).default(""),
  public_recruitment_email: z
    .string()
    .email()
    .max(200)
    .optional()
    .nullable()
    .or(z.literal("")),
  is_remote: z.boolean().optional().default(false),
});

const ImportSchema = z.object({
  action: z.literal("import"),
  offers: z.array(SingleOfferSchema).min(1).max(10),
});

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { searchParams } = new URL(request.url);
  const locationsRaw = searchParams.get("locations") ?? "";
  const activeLocations = locationsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [{ data: profile }, { data: prefs }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("user_preferences")
      .select("desired_roles, preferred_locations")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const effectiveLocations =
    activeLocations.length > 0
      ? activeLocations
      : prefs?.preferred_locations?.length
        ? prefs.preferred_locations
        : ["Morocco"];

  const presets = buildProfileMatchedLinkedInSearches({
    profile: profile ?? undefined,
    desiredRoles: prefs?.desired_roles ?? [],
    activeLocations: effectiveLocations,
  });

  return NextResponse.json({
    presets,
    profileSummary: {
      professional_title: profile?.professional_title || "",
      location: profile?.location || "",
      top_skills: (profile?.technical_skills ?? []).slice(0, 6),
      years_of_experience: profile?.years_of_experience ?? 0,
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    const rawBody = await request.json();

    if (rawBody?.action === "preview_url") {
      const parsed = PreviewSchema.parse(rawBody);
      const preview = await inspectPublicJobOfferUrl(parsed.url);
      return NextResponse.json({ preview });
    }

    const parsed = ImportSchema.parse(rawBody);

    const [{ data: profile }, { data: activeResume }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase
        .from("resumes")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

    const importedJobs: Array<Record<string, any>> = [];

    for (const offer of parsed.offers) {
      const built = buildImportedJobRecord({
        url: offer.url,
        title: offer.title,
        company_name: offer.company_name,
        location: offer.location,
        description: offer.description,
        public_recruitment_email: offer.public_recruitment_email || null,
        is_remote: offer.is_remote,
      });

      const normCompany = normalizeCompanyName(built.company_name);
      const { data: companyRow } = await supabase
        .from("companies")
        .upsert(
          {
            user_id: user.id,
            name: built.company_name,
            normalized_name: normCompany || "imported-company",
            industry: built.sector || "Technology",
            location: built.location,
            country_code: built.country_code,
            careers_page: built.application_url,
            ats_provider: "direct",
            public_recruitment_email: built.public_recruitment_email ?? null,
            email_source_url: built.public_recruitment_email
              ? built.application_url
              : null,
            application_method: "published_vacancies",
            vacancies_count: 1,
            relevance_score: 82,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "user_id,normalized_name" }
        )
        .select("id")
        .single();

      const dedupHash = computeJobDedupHash({
        source: built.source,
        external_id: built.external_id,
        application_url: built.application_url,
        title: built.title,
        company_name: built.company_name,
      });

      const { data: savedJob, error: jobErr } = await supabase
        .from("jobs")
        .upsert(
          {
            user_id: user.id,
            company_id: companyRow?.id ?? null,
            external_id: built.external_id,
            dedup_hash: dedupHash,
            source: built.source,
            title: built.title,
            company_name: built.company_name,
            location: built.location,
            country_code: built.country_code,
            is_remote: built.is_remote,
            contract_type: built.contract_type,
            sector: built.sector,
            description: built.description,
            required_skills: built.required_skills,
            experience_requirements: built.experience_requirements,
            detected_language: built.detected_language,
            public_recruitment_email: built.public_recruitment_email ?? null,
            application_url: built.application_url,
            normalized_url: normalizeJobUrl(built.application_url),
            published_at: built.published_at,
            raw_metadata: built.raw_metadata ?? {},
          },
          { onConflict: "user_id,dedup_hash" }
        )
        .select("*")
        .single();

      if (jobErr || !savedJob) {
        throw new Error(jobErr?.message || "Failed to save imported job offer.");
      }

      const matchAnalysis = calculateDeterministicJobMatch({
        profile: profile ?? {},
        job: {
          title: savedJob.title,
          company_name: savedJob.company_name,
          location: savedJob.location,
          is_remote: savedJob.is_remote,
          contract_type: savedJob.contract_type,
          sector: savedJob.sector,
          description: savedJob.description,
          required_skills: savedJob.required_skills ?? [],
          experience_requirements: savedJob.experience_requirements ?? "",
          detected_language: savedJob.detected_language,
        },
        targetLocations: [savedJob.location],
        preferredSectors: profile?.sectors ?? [],
      });

      const { data: savedMatch } = await supabase
        .from("job_matches")
        .upsert(
          {
            user_id: user.id,
            job_id: savedJob.id,
            resume_id: activeResume?.id ?? null,
            match_score: matchAnalysis.match_score,
            score_breakdown: matchAnalysis.score_breakdown,
            matching_skills: matchAnalysis.matching_skills,
            missing_skills: matchAnalysis.missing_skills,
            strengths: matchAnalysis.strengths,
            weaknesses: matchAnalysis.weaknesses,
            recommendation: matchAnalysis.recommendation,
            explanation: matchAnalysis.explanation,
            scoring_method: "deterministic",
          },
          { onConflict: "user_id,job_id" }
        )
        .select("*")
        .single();

      importedJobs.push({
        ...savedJob,
        match: savedMatch ?? matchAnalysis,
      });
    }

    return NextResponse.json({
      importedCount: importedJobs.length,
      jobs: importedJobs,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not import LinkedIn / external job offer.",
      },
      { status: 400 }
    );
  }
}
