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

export interface AdzunaFetchResult {
  source: "adzuna";
  status: "ok" | "requires_configuration" | "error";
  jobs: DiscoveredJobInput[];
  message?: string;
}

const ADZUNA_COUNTRY_MAP: Record<string, { code: string; currency: string }> = {
  france: { code: "fr", currency: "EUR" },
  fr: { code: "fr", currency: "EUR" },
  europe: { code: "de", currency: "EUR" },
  de: { code: "de", currency: "EUR" },
  gb: { code: "gb", currency: "GBP" },
  uk: { code: "gb", currency: "GBP" },
  nl: { code: "nl", currency: "EUR" },
  us: { code: "us", currency: "USD" },
  international: { code: "gb", currency: "GBP" },
};

export async function fetchAdzunaJobs(params: {
  query?: string;
  locations?: string[];
  limit?: number;
}): Promise<AdzunaFetchResult> {
  const appId = process.env.ADZUNA_APP_ID?.trim();
  const appKey = process.env.ADZUNA_APP_KEY?.trim();

  if (!appId || !appKey) {
    return {
      source: "adzuna",
      status: "requires_configuration",
      jobs: [],
      message:
        "Adzuna API credentials (ADZUNA_APP_ID, ADZUNA_APP_KEY) are not configured. Public job feeds remain active.",
    };
  }

  const explicitLocations = (params.locations ?? [])
    .map((l) => l.trim())
    .filter(Boolean);
  const requestedCountries = new Set<string>();
  for (const loc of explicitLocations.length > 0 ? explicitLocations : ["fr"]) {
    const mapped = ADZUNA_COUNTRY_MAP[loc.toLowerCase()];
    if (mapped) requestedCountries.add(mapped.code);
  }
  if (requestedCountries.size === 0) {
    return {
      source: "adzuna",
      status: "ok",
      jobs: [],
      message:
        "Adzuna has no regional endpoint for the selected country (e.g. Morocco); using authorized Morocco ATS feeds.",
    };
  }

  const perCountry = Math.min(Math.max(params.limit ?? 15, 5), 25);
  const allJobs: DiscoveredJobInput[] = [];

  try {
    for (const countryCode of Array.from(requestedCountries).slice(0, 2)) {
      const endpoint = new URL(
        `https://api.adzuna.com/v1/api/jobs/${countryCode}/search/1`
      );
      endpoint.searchParams.set("app_id", appId);
      endpoint.searchParams.set("app_key", appKey);
      endpoint.searchParams.set("results_per_page", String(perCountry));
      if (params.query?.trim()) {
        endpoint.searchParams.set("what", params.query.trim());
      }

      const res = await fetch(endpoint.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) {
        return {
          source: "adzuna",
          status: "error",
          jobs: allJobs,
          message: `Adzuna (${countryCode}) returned HTTP ${res.status}`,
        };
      }

      const data = (await res.json()) as { results?: Array<Record<string, any>> };
      const currency = countryCode === "gb" ? "GBP" : countryCode === "us" ? "USD" : "EUR";

      for (const item of data.results ?? []) {
        const title = stripHtmlToText(String(item.title ?? ""));
        const description = stripHtmlToText(String(item.description ?? ""));
        const location = String(
          item.location?.display_name ?? countryCode.toUpperCase()
        );
        const salaryMin = item.salary_min ? Number(item.salary_min) : null;
        const salaryMax = item.salary_max ? Number(item.salary_max) : null;

        allJobs.push({
          external_id: String(item.id ?? item.redirect_url ?? title),
          source: "adzuna",
          title,
          company_name: String(
            item.company?.display_name ?? "Employer via Adzuna"
          ).trim(),
          company_website: null,
          company_careers_page: String(item.redirect_url ?? ""),
          location,
          country_code: countryCode.toUpperCase(),
          is_remote: /remote|t[ée]l[ée]travail/i.test(`${title} ${location} ${description}`),
          contract_type:
            item.contract_time === "part_time"
              ? "part_time"
              : item.contract_type === "contract"
                ? "contract"
                : "full_time",
          sector: inferJobSector(
            title,
            `${item.category?.label ?? ""} ${description}`
          ),
          description: description.slice(0, 12000),
          required_skills: extractSkillsFromJobText(`${title}\n${description}`),
          experience_requirements: extractExperienceRequirements(description),
          salary_min: salaryMin,
          salary_max: salaryMax,
          salary_currency: salaryMin || salaryMax ? currency : null,
          salary_text:
            salaryMin && salaryMax
              ? `${Math.round(salaryMin).toLocaleString()} - ${Math.round(salaryMax).toLocaleString()} ${currency}`
              : null,
          detected_language: detectTextLanguage(`${title}\n${description}`),
          public_recruitment_email: extractPublishedRecruitmentEmail(description),
          application_url: String(item.redirect_url ?? "").trim(),
          published_at: item.created ? new Date(item.created).toISOString() : null,
          application_deadline: null,
          raw_metadata: {
            category: item.category?.label ?? null,
          },
        });
      }
    }

    return { source: "adzuna", status: "ok", jobs: allJobs };
  } catch (err) {
    return {
      source: "adzuna",
      status: "error",
      jobs: allJobs,
      message: err instanceof Error ? err.message : "Adzuna fetch error",
    };
  }
}
