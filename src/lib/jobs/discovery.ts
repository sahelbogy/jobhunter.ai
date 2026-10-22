import type { SupabaseClient } from "@supabase/supabase-js";
import type { DiscoveredJobInput, UserProfile } from "@/types/domain";
import {
  deduplicateDiscoveredJobs,
  normalizeCompanyName,
} from "@/lib/jobs/dedup";
import { fetchRemotiveJobs } from "@/lib/jobs/sources/remotive";
import { fetchArbeitnowJobs } from "@/lib/jobs/sources/arbeitnow";
import { fetchAdzunaJobs } from "@/lib/jobs/sources/adzuna";
import {
  AUTHORIZED_COMPANY_BOARDS,
  fetchAuthorizedCompanyBoardJobs,
} from "@/lib/jobs/sources/company-boards";
import {
  matchesSelectedLocations,
  parseSelectedLocations,
} from "@/lib/jobs/location-filter";
import { calculateDeterministicJobMatch } from "@/lib/matching/engine";

export interface DiscoverySearchFilters {
  query?: string;
  locations?: string[];
  sector?: string;
  remotePreference?: "any" | "remote_only" | "hybrid" | "onsite";
  contractType?: string;
  language?: "any" | "fr" | "en";
  minSalary?: number | null;
  limit?: number;
}

export interface SourceStatusReport {
  source: string;
  status: "ok" | "requires_configuration" | "partial" | "error";
  count: number;
  message?: string;
}

export interface DiscoveryExecutionSummary {
  discoveredCount: number;
  insertedOrUpdatedCount: number;
  duplicatesRemoved: number;
  matchesComputed: number;
  companiesUpdated: number;
  sourceReports: SourceStatusReport[];
  jobs: Array<Record<string, any>>;
}

export async function runJobDiscoveryForUser(params: {
  supabase: SupabaseClient;
  userId: string;
  profile: Partial<UserProfile>;
  filters: DiscoverySearchFilters;
  activeResumeId?: string | null;
}): Promise<DiscoveryExecutionSummary> {
  const { supabase, userId, profile, filters } = params;

  const derivedQuery =
    filters.query?.trim() ||
    profile.professional_title?.trim() ||
    profile.technical_skills?.slice(0, 2).join(" ") ||
    "";

  const locations =
    filters.locations && filters.locations.length > 0
      ? filters.locations
      : ["Morocco", "France", "Europe", "Remote"];

  const parsedLocs = parseSelectedLocations(locations);
  const shouldQueryArbeitnow =
    !parsedLocs.hasAnyFilter ||
    parsedLocs.wantsEurope ||
    parsedLocs.wantsFrance ||
    parsedLocs.wantsInternational;
  const shouldQueryRemotive =
    !parsedLocs.hasAnyFilter ||
    parsedLocs.wantsRemote ||
    parsedLocs.wantsInternational ||
    parsedLocs.wantsMorocco ||
    parsedLocs.wantsFrance ||
    parsedLocs.wantsEurope;

  const maxTotal = Math.min(Math.max(filters.limit ?? 35, 5), 60);

  const [remotiveRes, arbeitnowRes, companyBoardsRes, adzunaRes] =
    await Promise.all([
      shouldQueryRemotive
        ? fetchRemotiveJobs({ query: derivedQuery, limit: 20 })
        : Promise.resolve({
            source: "remotive" as const,
            status: "ok" as const,
            jobs: [],
            message: "Skipped Remote feed for strict on-site regional filter.",
          }),
      shouldQueryArbeitnow
        ? fetchArbeitnowJobs({ query: derivedQuery, limit: 20 })
        : Promise.resolve({
            source: "arbeitnow" as const,
            status: "ok" as const,
            jobs: [],
            message: "Skipped European Arbeitnow feed (strict Morocco/non-EU filter).",
          }),
      fetchAuthorizedCompanyBoardJobs({
        query: derivedQuery,
        locations,
        limitPerBoard: 14,
      }),
      fetchAdzunaJobs({
        query: derivedQuery,
        locations,
        limit: 15,
      }),
    ]);

  const sourceReports: SourceStatusReport[] = [
    {
      source: "remotive",
      status: remotiveRes.status,
      count: remotiveRes.jobs.length,
      message: remotiveRes.message,
    },
    {
      source: "arbeitnow",
      status: arbeitnowRes.status,
      count: arbeitnowRes.jobs.length,
      message: arbeitnowRes.message,
    },
    {
      source: "company_careers",
      status: companyBoardsRes.status,
      count: companyBoardsRes.jobs.length,
      message: `Queried ${companyBoardsRes.boardsQueried.length} official ATS boards`,
    },
    {
      source: "adzuna",
      status: adzunaRes.status,
      count: adzunaRes.jobs.length,
      message: adzunaRes.message,
    },
  ];

  let combined: DiscoveredJobInput[] = [
    ...companyBoardsRes.jobs,
    ...remotiveRes.jobs,
    ...arbeitnowRes.jobs,
    ...adzunaRes.jobs,
  ];

  // Apply explicit user search filters INCLUDING strict regional / country boundaries
  combined = combined.filter((job) => {
    if (!matchesSelectedLocations(job, locations)) {
      return false;
    }
    if (filters.remotePreference === "remote_only" && !job.is_remote) {
      return false;
    }
    if (filters.remotePreference === "onsite" && job.is_remote) {
      return false;
    }
    if (
      filters.contractType &&
      filters.contractType !== "any" &&
      job.contract_type !== filters.contractType
    ) {
      return false;
    }
    if (
      filters.language &&
      filters.language !== "any" &&
      job.detected_language !== filters.language
    ) {
      return false;
    }
    if (
      filters.sector &&
      filters.sector !== "any" &&
      !job.sector.toLowerCase().includes(filters.sector.toLowerCase())
    ) {
      return false;
    }
    if (
      filters.minSalary &&
      filters.minSalary > 0 &&
      job.salary_max &&
      job.salary_max < filters.minSalary
    ) {
      return false;
    }
    if (filters.query?.trim()) {
      const tokens = filters.query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 2);
      const hay =
        `${job.title} ${job.company_name} ${job.sector} ${job.required_skills.join(" ")} ${job.description.slice(0, 1200)}`.toLowerCase();
      if (tokens.length > 0 && !tokens.some((tok) => hay.includes(tok))) {
        return false;
      }
    }
    return true;
  });

  const { unique, duplicatesRemoved } = deduplicateDiscoveredJobs(combined);
  const capped = unique.slice(0, maxTotal);

  // Upsert discovered companies first so jobs link cleanly to company_id
  const companyMap = new Map<
    string,
    {
      name: string;
      normalized_name: string;
      industry: string;
      website: string | null;
      location: string;
      careers_page: string | null;
      ats_provider: string | null;
      ats_slug: string | null;
      public_recruitment_email: string | null;
      email_source_url: string | null;
      description: string;
      vacancies_count: number;
      matching_sectors: Set<string>;
    }
  >();

  for (const job of capped) {
    const norm = normalizeCompanyName(job.company_name);
    if (!norm) continue;
    const curated = AUTHORIZED_COMPANY_BOARDS.find(
      (b) => normalizeCompanyName(b.name) === norm
    );
    const existing = companyMap.get(norm);
    if (existing) {
      existing.vacancies_count += 1;
      existing.matching_sectors.add(job.sector);
      if (!existing.public_recruitment_email && job.public_recruitment_email) {
        existing.public_recruitment_email = job.public_recruitment_email;
        existing.email_source_url = job.application_url;
      }
    } else {
      companyMap.set(norm, {
        name: job.company_name,
        normalized_name: norm,
        industry: curated?.industry ?? job.sector,
        website: curated?.website ?? job.company_website ?? null,
        location: job.location,
        careers_page: curated?.careersPage ?? job.company_careers_page ?? job.application_url,
        ats_provider:
          curated?.provider ??
          job.company_ats_provider ??
          (job.source === "adzuna" || job.source === "remotive" || job.source === "arbeitnow"
            ? "aggregator"
            : null),
        ats_slug: curated?.slug ?? job.company_ats_slug ?? null,
        public_recruitment_email: job.public_recruitment_email ?? null,
        email_source_url: job.public_recruitment_email ? job.application_url : null,
        description:
          curated?.description ??
          `Active employer publishing verified positions in ${job.sector} (${job.location}).`,
        vacancies_count: 1,
        matching_sectors: new Set([job.sector]),
      });
    }
  }

  const companyIdByNorm = new Map<string, string>();
  if (companyMap.size > 0) {
    const companyRows = Array.from(companyMap.values()).map((c) => ({
      user_id: userId,
      name: c.name,
      normalized_name: c.normalized_name,
      industry: c.industry,
      website: c.website,
      location: c.location,
      careers_page: c.careers_page,
      ats_provider: c.ats_provider,
      ats_slug: c.ats_slug,
      public_recruitment_email: c.public_recruitment_email,
      email_source_url: c.email_source_url,
      description: c.description,
      application_method: "published_vacancies" as const,
      vacancies_count: c.vacancies_count,
      matching_sectors: Array.from(c.matching_sectors),
      last_synced_at: new Date().toISOString(),
    }));

    const { data: upsertedCompanies } = await supabase
      .from("companies")
      .upsert(companyRows, { onConflict: "user_id,normalized_name" })
      .select("id, normalized_name");

    for (const c of upsertedCompanies ?? []) {
      companyIdByNorm.set(c.normalized_name, c.id);
    }
  }

  if (capped.length === 0) {
    return {
      discoveredCount: combined.length,
      insertedOrUpdatedCount: 0,
      duplicatesRemoved,
      matchesComputed: 0,
      companiesUpdated: companyIdByNorm.size,
      sourceReports,
      jobs: [],
    };
  }

  const jobRows = capped.map((job) => ({
    user_id: userId,
    company_id: companyIdByNorm.get(normalizeCompanyName(job.company_name)) ?? null,
    external_id: job.external_id,
    dedup_hash: job.dedup_hash,
    source: job.source,
    title: job.title,
    company_name: job.company_name,
    location: job.location,
    country_code: job.country_code ?? null,
    is_remote: job.is_remote,
    contract_type: job.contract_type,
    sector: job.sector,
    description: job.description,
    required_skills: job.required_skills,
    experience_requirements: job.experience_requirements,
    salary_min: job.salary_min ?? null,
    salary_max: job.salary_max ?? null,
    salary_currency: job.salary_currency ?? null,
    salary_text: job.salary_text ?? null,
    detected_language: job.detected_language,
    public_recruitment_email: job.public_recruitment_email ?? null,
    application_url: job.application_url,
    normalized_url: job.normalized_url,
    published_at: job.published_at ?? null,
    application_deadline: job.application_deadline ?? null,
    raw_metadata: job.raw_metadata ?? {},
  }));

  const { data: persistedJobs, error: jobsError } = await supabase
    .from("jobs")
    .upsert(jobRows, { onConflict: "user_id,dedup_hash" })
    .select("*");

  if (jobsError || !persistedJobs) {
    throw new Error(
      `Failed to persist discovered jobs: ${jobsError?.message ?? "Unknown DB error"}`
    );
  }

  // Compute compatibility match scores immediately for every persisted job
  const matchRows = persistedJobs.map((job) => {
    const analysis = calculateDeterministicJobMatch({
      profile,
      job: {
        id: job.id,
        title: job.title,
        company_name: job.company_name,
        location: job.location,
        is_remote: job.is_remote,
        contract_type: job.contract_type,
        sector: job.sector,
        description: job.description,
        required_skills: job.required_skills ?? [],
        experience_requirements: job.experience_requirements,
        detected_language: job.detected_language,
      },
      targetLocations: locations,
      preferredSectors: filters.sector ? [filters.sector] : profile.sectors,
    });

    return {
      user_id: userId,
      job_id: job.id,
      resume_id: params.activeResumeId ?? null,
      match_score: analysis.match_score,
      score_breakdown: analysis.score_breakdown,
      matching_skills: analysis.matching_skills,
      missing_skills: analysis.missing_skills,
      strengths: analysis.strengths,
      weaknesses: analysis.weaknesses,
      recommendation: analysis.recommendation,
      explanation: analysis.explanation,
      scoring_method: "deterministic",
    };
  });

  const { data: persistedMatches } = await supabase
    .from("job_matches")
    .upsert(matchRows, { onConflict: "user_id,job_id" })
    .select("*");

  const matchByJobId = new Map<string, any>();
  for (const m of persistedMatches ?? []) {
    matchByJobId.set(m.job_id, m);
  }

  const enrichedJobs = persistedJobs
    .map((j) => ({
      ...j,
      match: matchByJobId.get(j.id) ?? null,
    }))
    .sort(
      (a, b) => (b.match?.match_score ?? 0) - (a.match?.match_score ?? 0)
    );

  return {
    discoveredCount: combined.length,
    insertedOrUpdatedCount: persistedJobs.length,
    duplicatesRemoved,
    matchesComputed: persistedMatches?.length ?? 0,
    companiesUpdated: companyIdByNorm.size,
    sourceReports,
    jobs: enrichedJobs,
  };
}
