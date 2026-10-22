import type { DiscoveredJobInput } from "@/types/domain";
import {
  extractPublishedRecruitmentEmail,
  stripHtmlToText,
} from "@/lib/security/sanitize";
import { detectTextLanguage } from "@/lib/documents/language";
import {
  extractExperienceRequirements,
  extractSkillsFromJobText,
  inferJobSector,
} from "@/lib/jobs/dedup";

export interface SourceFetchResult {
  source: "remotive";
  status: "ok" | "error";
  jobs: DiscoveredJobInput[];
  message?: string;
}

export async function fetchRemotiveJobs(params: {
  query?: string;
  limit?: number;
}): Promise<SourceFetchResult> {
  const limit = Math.min(Math.max(params.limit ?? 25, 5), 50);
  const url = new URL("https://remotive.com/api/remote-jobs");
  if (params.query?.trim()) {
    url.searchParams.set("search", params.query.trim());
  }
  url.searchParams.set("limit", String(limit));

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "AI-Job-Hunter/1.0 (+https://remotive.com)",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return {
        source: "remotive",
        status: "error",
        jobs: [],
        message: `Remotive API returned HTTP ${res.status}`,
      };
    }

    const payload = (await res.json()) as {
      jobs?: Array<Record<string, any>>;
    };
    const rawJobs = Array.isArray(payload.jobs) ? payload.jobs : [];

    const jobs: DiscoveredJobInput[] = rawJobs.slice(0, limit).map((item) => {
      const description = stripHtmlToText(String(item.description ?? ""));
      const title = String(item.title ?? "").trim();
      const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
      const location =
        String(item.candidate_required_location ?? "").trim() || "Worldwide Remote";

      return {
        external_id: String(item.id ?? item.url ?? title),
        source: "remotive",
        title,
        company_name: String(item.company_name ?? "Unknown Company").trim(),
        company_website: null,
        company_careers_page: String(item.url ?? ""),
        location,
        country_code: null,
        is_remote: true,
        contract_type: normalizeContractType(String(item.job_type ?? "full_time")),
        sector: inferJobSector(title, `${ item.category ?? "" } ${description}`),
        description: description.slice(0, 12000),
        required_skills: extractSkillsFromJobText(`${title}\n${description}`, tags),
        experience_requirements: extractExperienceRequirements(description),
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_text: item.salary ? String(item.salary).trim() : null,
        detected_language: detectTextLanguage(`${title}\n${description}`),
        public_recruitment_email: extractPublishedRecruitmentEmail(description),
        application_url: String(item.url ?? "").trim(),
        published_at: item.publication_date
          ? new Date(item.publication_date).toISOString()
          : null,
        application_deadline: null,
        raw_metadata: {
          attribution: "Remotive",
          category: item.category ?? null,
        },
      };
    });

    return { source: "remotive", status: "ok", jobs };
  } catch (err) {
    return {
      source: "remotive",
      status: "error",
      jobs: [],
      message: err instanceof Error ? err.message : "Remotive fetch failed",
    };
  }
}

function normalizeContractType(raw: string): string {
  const v = raw.toLowerCase();
  if (v.includes("intern") || v.includes("stage")) return "internship";
  if (v.includes("part")) return "part_time";
  if (v.includes("contract") || v.includes("freelance")) return "contract";
  return "full_time";
}
