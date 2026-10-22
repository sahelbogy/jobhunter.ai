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

export interface ArbeitnowFetchResult {
  source: "arbeitnow";
  status: "ok" | "error";
  jobs: DiscoveredJobInput[];
  message?: string;
}

export async function fetchArbeitnowJobs(params: {
  query?: string;
  limit?: number;
}): Promise<ArbeitnowFetchResult> {
  const limit = Math.min(Math.max(params.limit ?? 25, 5), 50);

  try {
    const res = await fetch("https://www.arbeitnow.com/api/job-board-api", {
      headers: {
        Accept: "application/json",
        "User-Agent": "AI-Job-Hunter/1.0",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return {
        source: "arbeitnow",
        status: "error",
        jobs: [],
        message: `Arbeitnow API returned HTTP ${res.status}`,
      };
    }

    const payload = (await res.json()) as {
      data?: Array<Record<string, any>>;
    };
    const rawList = Array.isArray(payload.data) ? payload.data : [];
    const q = params.query?.trim().toLowerCase() ?? "";

    const filtered = q
      ? rawList.filter((item) => {
          const hay = `${item.title ?? ""} ${item.company_name ?? ""} ${(
            item.tags ?? []
          ).join(" ")} ${item.location ?? ""}`.toLowerCase();
          return q
            .split(/\s+/)
            .filter(Boolean)
            .some((token) => hay.includes(token));
        })
      : rawList;

    const jobs: DiscoveredJobInput[] = filtered.slice(0, limit).map((item) => {
      const description = stripHtmlToText(String(item.description ?? ""));
      const title = String(item.title ?? "").trim();
      const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
      const jobTypes = Array.isArray(item.job_types)
        ? item.job_types.join(", ")
        : "full_time";
      const createdAtSec = Number(item.created_at ?? 0);

      return {
        external_id: String(item.slug ?? item.url ?? title),
        source: "arbeitnow",
        title,
        company_name: String(item.company_name ?? "Unknown Company").trim(),
        company_website: null,
        company_careers_page: String(item.url ?? ""),
        location: String(item.location ?? "Europe").trim() || "Europe",
        country_code: "EU",
        is_remote: Boolean(item.remote),
        contract_type: /intern|stage/i.test(jobTypes)
          ? "internship"
          : /part/i.test(jobTypes)
            ? "part_time"
            : /contract|freelance/i.test(jobTypes)
              ? "contract"
              : "full_time",
        sector: inferJobSector(title, description),
        description: description.slice(0, 12000),
        required_skills: extractSkillsFromJobText(`${title}\n${description}`, tags),
        experience_requirements: extractExperienceRequirements(description),
        salary_min: null,
        salary_max: null,
        salary_currency: "EUR",
        salary_text: null,
        detected_language: detectTextLanguage(`${title}\n${description}`),
        public_recruitment_email: extractPublishedRecruitmentEmail(description),
        application_url: String(item.url ?? "").trim(),
        published_at:
          createdAtSec > 0 ? new Date(createdAtSec * 1000).toISOString() : null,
        application_deadline: null,
        raw_metadata: {
          visa_sponsorship: item.visa_sponsorship ?? null,
        },
      };
    });

    return { source: "arbeitnow", status: "ok", jobs };
  } catch (err) {
    return {
      source: "arbeitnow",
      status: "error",
      jobs: [],
      message: err instanceof Error ? err.message : "Arbeitnow fetch failed",
    };
  }
}
