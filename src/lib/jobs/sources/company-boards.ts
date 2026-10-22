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

export interface CuratedCompanyBoard {
  name: string;
  provider: "smartrecruiters" | "greenhouse" | "lever" | "ashby";
  slug: string;
  industry: string;
  website: string;
  careersPage: string;
  regions: Array<"morocco" | "france" | "europe" | "international" | "remote">;
  description: string;
}

/**
 * Curated directory of real employers publishing open positions via official,
 * documented, unauthenticated public ATS Posting APIs across Morocco, France,
 * Europe, and Remote/International hubs.
 */
export const AUTHORIZED_COMPANY_BOARDS: CuratedCompanyBoard[] = [
  {
    name: "SQLI Digital Experience",
    provider: "smartrecruiters",
    slug: "SQLI1",
    industry: "Digital Engineering & IT Consulting",
    website: "https://www.sqli.com",
    careersPage: "https://careers.smartrecruiters.com/SQLI1",
    regions: ["morocco", "france", "europe"],
    description:
      "European digital services group with major engineering delivery centers in Casablanca, Rabat, Oujda, Paris, Lyon, and Nantes.",
  },
  {
    name: "Ubisoft",
    provider: "smartrecruiters",
    slug: "Ubisoft2",
    industry: "Interactive Entertainment & Software",
    website: "https://www.ubisoft.com",
    careersPage: "https://careers.smartrecruiters.com/Ubisoft2",
    regions: ["morocco", "france", "europe", "international"],
    description:
      "Global software & gaming publisher operating studios across France, Europe, North America, and MENA.",
  },
  {
    name: "Devoteam",
    provider: "smartrecruiters",
    slug: "Devoteam",
    industry: "AI, Cloud & Cybersecurity Consulting",
    website: "https://www.devoteam.com",
    careersPage: "https://careers.smartrecruiters.com/Devoteam",
    regions: ["morocco", "france", "europe"],
    description:
      "AI-driven tech consulting firm active in Morocco (Casablanca/Rabat), France, and 20+ EMEA countries.",
  },
  {
    name: "Bosch Group",
    provider: "smartrecruiters",
    slug: "BoschGroup",
    industry: "Engineering, IoT & Mobility Technology",
    website: "https://www.bosch.com",
    careersPage: "https://careers.smartrecruiters.com/BoschGroup",
    regions: ["morocco", "france", "europe", "international"],
    description:
      "Global engineering and technology company with operations in Casablanca, France, Germany, and worldwide.",
  },
  {
    name: "Visa",
    provider: "smartrecruiters",
    slug: "Visa",
    industry: "FinTech & Global Payments",
    website: "https://www.visa.com",
    careersPage: "https://careers.smartrecruiters.com/Visa",
    regions: ["morocco", "europe", "international"],
    description:
      "Global digital payments technology leader with regional offices across CEMEA (including Casablanca), Europe, and Americas.",
  },
  {
    name: "Doctolib",
    provider: "greenhouse",
    slug: "doctolib",
    industry: "HealthTech SaaS",
    website: "https://www.doctolib.fr",
    careersPage: "https://boards.greenhouse.io/doctolib",
    regions: ["france", "europe"],
    description:
      "Leading European e-health software company headquartered in Paris with engineering hubs in France, Germany, and Italy.",
  },
  {
    name: "Datadog",
    provider: "greenhouse",
    slug: "datadog",
    industry: "Cloud Observability & Security",
    website: "https://www.datadoghq.com",
    careersPage: "https://boards.greenhouse.io/datadog",
    regions: ["france", "europe", "international"],
    description:
      "Cloud monitoring and security platform with major R&D engineering hub in Paris, Madrid, Lisbon, and New York.",
  },
  {
    name: "Criteo",
    provider: "greenhouse",
    slug: "criteo",
    industry: "AI & Commerce Media",
    website: "https://www.criteo.com",
    careersPage: "https://boards.greenhouse.io/criteo",
    regions: ["france", "europe", "international"],
    description:
      "Global AI and commerce media technology company founded in Paris with AI Labs and engineering teams worldwide.",
  },
  {
    name: "GitLab",
    provider: "greenhouse",
    slug: "gitlab",
    industry: "DevSecOps Platform",
    website: "https://about.gitlab.com",
    careersPage: "https://boards.greenhouse.io/gitlab",
    regions: ["remote", "europe", "international"],
    description:
      "All-remote DevSecOps software company hiring across EMEA and global remote regions.",
  },
  {
    name: "Qonto",
    provider: "lever",
    slug: "qonto",
    industry: "FinTech & Business Finance",
    website: "https://qonto.com",
    careersPage: "https://jobs.lever.co/qonto",
    regions: ["france", "europe", "remote"],
    description:
      "European business finance solution headquartered in Paris with teams in Barcelona, Berlin, Belgrade, and Milan.",
  },
  {
    name: "Linear",
    provider: "ashby",
    slug: "linear",
    industry: "Developer Tools & Product SaaS",
    website: "https://linear.app",
    careersPage: "https://jobs.ashbyhq.com/linear",
    regions: ["remote", "europe", "international"],
    description:
      "Modern software planning and issue tracking company with distributed European and North American engineering.",
  },
];

export async function probeSmartRecruitersBoard(params: {
  slug: string;
  companyName: string;
  website?: string;
  query?: string;
  countryCode?: string;
  limit?: number;
}): Promise<DiscoveredJobInput[]> {
  const limit = Math.min(params.limit ?? 20, 50);
  const url = new URL(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(
      params.slug
    )}/postings`
  );
  url.searchParams.set("limit", String(limit));
  if (params.query?.trim()) {
    url.searchParams.set("q", params.query.trim());
  }
  if (params.countryCode?.trim()) {
    url.searchParams.set("country", params.countryCode.trim().toLowerCase());
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "AI-Job-Hunter/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { content?: Array<Record<string, any>> };
  const postings = Array.isArray(data.content) ? data.content : [];

  return postings.slice(0, limit).map((p) => {
    const city = p.location?.city ?? "";
    const country = p.location?.country?.toUpperCase?.() ?? "";
    const fullLoc =
      p.location?.fullLocation ||
      [city, country].filter(Boolean).join(", ") ||
      "Global";
    const title = String(p.name ?? "").trim();
    const dept = p.department?.label ?? "";
    const expLabel = p.experienceLevel?.label ?? "";
    const postingId = String(p.id ?? p.uuid ?? title);
    const applyUrl = `https://jobs.smartrecruiters.com/${params.slug}/${postingId}`;
    const summaryText = [
      title,
      dept ? `Department: ${dept}` : "",
      expLabel ? `Experience Level: ${expLabel}` : "",
      `Location: ${fullLoc}`,
      `Company: ${params.companyName}`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      external_id: `${params.slug}:${postingId}`,
      source: "smartrecruiters",
      title,
      company_name: params.companyName,
      company_website: params.website ?? null,
      company_careers_page: `https://careers.smartrecruiters.com/${params.slug}`,
      company_ats_provider: "smartrecruiters",
      company_ats_slug: params.slug,
      location: fullLoc,
      country_code: country || null,
      is_remote: Boolean(p.location?.remote) || /remote|t[ée]l[ée]travail/i.test(fullLoc),
      contract_type: /intern|stage/i.test(`${title} ${p.typeOfEmployment?.label ?? ""}`)
        ? "internship"
        : "full_time",
      sector: inferJobSector(title, dept),
      description: summaryText,
      required_skills: extractSkillsFromJobText(`${title} ${dept}`),
      experience_requirements: expLabel || extractExperienceRequirements(title),
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_text: null,
      detected_language: detectTextLanguage(`${title} ${fullLoc}`),
      public_recruitment_email: null,
      application_url: applyUrl,
      published_at: p.releasedDate
        ? new Date(p.releasedDate).toISOString()
        : null,
      application_deadline: null,
      raw_metadata: {
        department: dept,
        ats: "smartrecruiters",
      },
    };
  });
}

export async function probeGreenhouseBoard(params: {
  slug: string;
  companyName: string;
  website?: string;
  limit?: number;
}): Promise<DiscoveredJobInput[]> {
  const limit = Math.min(params.limit ?? 20, 40);
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
    params.slug
  )}/jobs?content=true`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "AI-Job-Hunter/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { jobs?: Array<Record<string, any>> };
  const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];

  return rawJobs.slice(0, limit).map((j) => {
    const title = String(j.title ?? "").trim();
    const description = stripHtmlToText(String(j.content ?? ""));
    const location = String(j.location?.name ?? "Global").trim();

    return {
      external_id: `${params.slug}:${j.id}`,
      source: "greenhouse",
      title,
      company_name: params.companyName,
      company_website: params.website ?? null,
      company_careers_page: `https://boards.greenhouse.io/${params.slug}`,
      company_ats_provider: "greenhouse",
      company_ats_slug: params.slug,
      location,
      country_code: null,
      is_remote: /remote|anywhere|t[ée]l[ée]travail/i.test(location),
      contract_type: /intern|stage/i.test(title) ? "internship" : "full_time",
      sector: inferJobSector(title, description),
      description: description.slice(0, 12000),
      required_skills: extractSkillsFromJobText(`${title}\n${description}`),
      experience_requirements: extractExperienceRequirements(description),
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_text: null,
      detected_language: detectTextLanguage(`${title}\n${description}`),
      public_recruitment_email: extractPublishedRecruitmentEmail(description),
      application_url: String(j.absolute_url ?? "").trim(),
      published_at: j.updated_at ? new Date(j.updated_at).toISOString() : null,
      application_deadline: null,
      raw_metadata: { ats: "greenhouse" },
    };
  });
}

export async function probeLeverBoard(params: {
  slug: string;
  companyName: string;
  website?: string;
  limit?: number;
}): Promise<DiscoveredJobInput[]> {
  const limit = Math.min(params.limit ?? 20, 40);
  const endpoints = [
    `https://api.lever.co/v0/postings/${encodeURIComponent(params.slug)}?mode=json&limit=${limit}`,
    `https://api.eu.lever.co/v0/postings/${encodeURIComponent(params.slug)}?mode=json&limit=${limit}`,
  ];

  let postings: Array<Record<string, any>> = [];
  for (const ep of endpoints) {
    const res = await fetch(ep, {
      headers: { Accept: "application/json", "User-Agent": "AI-Job-Hunter/1.0" },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (res && res.ok) {
      const parsed = await res.json();
      if (Array.isArray(parsed)) {
        postings = parsed;
        break;
      }
    }
  }

  return postings.slice(0, limit).map((j) => {
    const title = String(j.text ?? "").trim();
    const description = stripHtmlToText(
      `${j.descriptionPlain ?? j.description ?? ""}\n${(j.lists ?? [])
        .map((l: any) => `${l.text ?? ""}: ${l.content ?? ""}`)
        .join("\n")}`
    );
    const location = String(j.categories?.location ?? "Europe").trim();

    return {
      external_id: `${params.slug}:${j.id}`,
      source: "lever",
      title,
      company_name: params.companyName,
      company_website: params.website ?? null,
      company_careers_page: `https://jobs.lever.co/${params.slug}`,
      company_ats_provider: "lever",
      company_ats_slug: params.slug,
      location,
      country_code: null,
      is_remote:
        j.workplaceType === "remote" || /remote|t[ée]l[ée]travail/i.test(location),
      contract_type: /intern|stage/i.test(
        `${title} ${j.categories?.commitment ?? ""}`
      )
        ? "internship"
        : "full_time",
      sector: inferJobSector(title, description),
      description: description.slice(0, 12000),
      required_skills: extractSkillsFromJobText(`${title}\n${description}`),
      experience_requirements: extractExperienceRequirements(description),
      salary_min: j.salaryRange?.min ? Number(j.salaryRange.min) : null,
      salary_max: j.salaryRange?.max ? Number(j.salaryRange.max) : null,
      salary_currency: j.salaryRange?.currency ?? null,
      salary_text:
        j.salaryRange?.min && j.salaryRange?.max
          ? `${j.salaryRange.min} - ${j.salaryRange.max} ${j.salaryRange.currency ?? ""}`.trim()
          : null,
      detected_language: detectTextLanguage(`${title}\n${description}`),
      public_recruitment_email: extractPublishedRecruitmentEmail(description),
      application_url: String(j.hostedUrl ?? "").trim(),
      published_at: j.createdAt ? new Date(Number(j.createdAt)).toISOString() : null,
      application_deadline: null,
      raw_metadata: { ats: "lever" },
    };
  });
}

export async function probeAshbyBoard(params: {
  slug: string;
  companyName: string;
  website?: string;
  limit?: number;
}): Promise<DiscoveredJobInput[]> {
  const limit = Math.min(params.limit ?? 20, 40);
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
    params.slug
  )}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "AI-Job-Hunter/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { jobs?: Array<Record<string, any>> };
  const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];

  return rawJobs.slice(0, limit).map((j) => {
    const title = String(j.title ?? "").trim();
    const description = stripHtmlToText(
      String(j.descriptionPlain ?? j.descriptionHtml ?? "")
    );
    const location = String(j.location ?? "Remote").trim();

    return {
      external_id: `${params.slug}:${j.id ?? title}`,
      source: "ashby",
      title,
      company_name: params.companyName,
      company_website: params.website ?? null,
      company_careers_page: `https://jobs.ashbyhq.com/${params.slug}`,
      company_ats_provider: "ashby",
      company_ats_slug: params.slug,
      location,
      country_code: null,
      is_remote: Boolean(j.isRemote) || /remote/i.test(location),
      contract_type: /intern/i.test(title) ? "internship" : "full_time",
      sector: inferJobSector(title, description),
      description: description.slice(0, 12000),
      required_skills: extractSkillsFromJobText(`${title}\n${description}`),
      experience_requirements: extractExperienceRequirements(description),
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_text: null,
      detected_language: detectTextLanguage(`${title}\n${description}`),
      public_recruitment_email: extractPublishedRecruitmentEmail(description),
      application_url: String(
        j.jobUrl ?? `https://jobs.ashbyhq.com/${params.slug}/${j.id}`
      ).trim(),
      published_at: j.publishedAt ? new Date(j.publishedAt).toISOString() : null,
      application_deadline: null,
      raw_metadata: { ats: "ashby" },
    };
  });
}

export async function fetchAuthorizedCompanyBoardJobs(params: {
  query?: string;
  locations?: string[];
  limitPerBoard?: number;
}): Promise<{
  status: "ok" | "partial" | "error";
  jobs: DiscoveredJobInput[];
  boardsQueried: string[];
}> {
  const locLower = (params.locations ?? []).map((l) => l.toLowerCase());
  const wantsMorocco =
    locLower.length === 0 ||
    locLower.some((l) =>
      /morocco|maroc|casablanca|rabat|tanger|tangier|marrakech|ma\b/.test(l)
    );
  const wantsFrance =
    locLower.length === 0 ||
    locLower.some((l) => /france|paris|lyon|nantes|fr\b/.test(l));
  const wantsEurope =
    locLower.length === 0 ||
    locLower.some((l) => /europe|eu|germany|spain|netherlands|uk/.test(l));
  const wantsRemote =
    locLower.length === 0 ||
    locLower.some((l) => /remote|international|worldwide|global/.test(l));

  const selectedBoards = AUTHORIZED_COMPANY_BOARDS.filter((b) => {
    if (wantsMorocco && b.regions.includes("morocco")) return true;
    if (wantsFrance && b.regions.includes("france")) return true;
    if (wantsEurope && b.regions.includes("europe")) return true;
    if (wantsRemote && (b.regions.includes("remote") || b.regions.includes("international")))
      return true;
    return false;
  }).slice(0, 7);

  const tasks = selectedBoards.map(async (board) => {
    try {
      if (board.provider === "smartrecruiters") {
        // When user specifically targets Morocco, also query country=ma first so Moroccan postings surface directly
        if (wantsMorocco && board.regions.includes("morocco")) {
          const maJobs = await probeSmartRecruitersBoard({
            slug: board.slug,
            companyName: board.name,
            website: board.website,
            query: params.query,
            countryCode: "ma",
            limit: params.limitPerBoard ?? 12,
          });
          if (maJobs.length > 0 && locLower.length === 1) {
            return maJobs;
          }
          const generalJobs = await probeSmartRecruitersBoard({
            slug: board.slug,
            companyName: board.name,
            website: board.website,
            query: params.query,
            limit: params.limitPerBoard ?? 10,
          });
          return [...maJobs, ...generalJobs];
        }
        return await probeSmartRecruitersBoard({
          slug: board.slug,
          companyName: board.name,
          website: board.website,
          query: params.query,
          limit: params.limitPerBoard ?? 12,
        });
      }
      if (board.provider === "greenhouse") {
        return await probeGreenhouseBoard({
          slug: board.slug,
          companyName: board.name,
          website: board.website,
          limit: params.limitPerBoard ?? 12,
        });
      }
      if (board.provider === "lever") {
        return await probeLeverBoard({
          slug: board.slug,
          companyName: board.name,
          website: board.website,
          limit: params.limitPerBoard ?? 12,
        });
      }
      return await probeAshbyBoard({
        slug: board.slug,
        companyName: board.name,
        website: board.website,
        limit: params.limitPerBoard ?? 12,
      });
    } catch {
      return [];
    }
  });

  const settled = await Promise.all(tasks);
  const combined = settled.flat();

  return {
    status: combined.length > 0 ? "ok" : "partial",
    jobs: combined,
    boardsQueried: selectedBoards.map((b) => `${b.provider}:${b.slug}`),
  };
}
