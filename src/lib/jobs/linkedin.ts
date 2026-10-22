import type { DiscoveredJobInput, UserProfile } from "@/types/domain";
import {
  extractPublishedRecruitmentEmail,
  normalizeJobUrl,
  stripHtmlToText,
} from "@/lib/security/sanitize";
import { detectTextLanguage } from "@/lib/documents/language";
import {
  extractExperienceRequirements,
  extractSkillsFromJobText,
  inferJobSector,
} from "@/lib/jobs/dedup";
import { parseSelectedLocations } from "@/lib/jobs/location-filter";

export interface LinkedInProfileSearchPreset {
  id: string;
  label: string;
  badge: string;
  keywords: string;
  locationLabel: string;
  timeFilterLabel: string;
  url: string;
  matchedFrom: string[];
}

const LINKEDIN_GEO_IDS: Record<string, { location: string; geoId: string }> = {
  morocco: { location: "Morocco", geoId: "102787409" },
  casablanca: {
    location: "Casablanca-Settat, Morocco",
    geoId: "104195383",
  },
  rabat: { location: "Rabat-Salé-Kénitra, Morocco", geoId: "106458008" },
  france: { location: "France", geoId: "105015875" },
  europe: { location: "European Union", geoId: "91000000" },
};

function isSafePublicHttpsUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host === "[::1]"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function extractLinkedInJobId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    const currentJobId = parsed.searchParams.get("currentJobId");
    if (currentJobId && /^\d{6,15}$/.test(currentJobId)) {
      return currentJobId;
    }
    const viewMatch = parsed.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,15})\/?/i);
    if (viewMatch?.[1]) {
      return viewMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generates targeted official LinkedIn Jobs search URLs aligned directly with the user's
 * saved CV profile (title, top technical skills, seniority, and selected region such as Morocco).
 */
export function buildProfileMatchedLinkedInSearches(params: {
  profile?: Partial<UserProfile> | null;
  desiredRoles?: string[];
  activeLocations?: string[];
}): LinkedInProfileSearchPreset[] {
  const { profile, desiredRoles = [], activeLocations = [] } = params;

  const primaryTitle =
    desiredRoles[0]?.trim() ||
    profile?.professional_title?.trim() ||
    "Software Engineer";

  const topSkills = [
    ...(profile?.technical_skills ?? []),
    ...(profile?.technologies ?? []),
  ]
    .map((s) => s.trim())
    .filter(Boolean);

  const uniqueSkills = Array.from(new Set(topSkills));
  const skillPair = uniqueSkills.slice(0, 2).join(" ");
  const secondarySkillPair = uniqueSkills.slice(2, 4).join(" ");

  const years = Number(profile?.years_of_experience ?? 0);
  // LinkedIn f_E: 2 = Entry, 3 = Associate, 4 = Mid-Senior
  const expCode = years >= 5 ? "4" : years >= 2 ? "3,4" : "2,3";

  const parsedLocs = parseSelectedLocations(activeLocations);
  const targets: Array<{ label: string; location: string; geoId?: string; remoteFlag?: boolean }> = [];

  if (
    parsedLocs.wantsMorocco ||
    (!parsedLocs.hasAnyFilter && /morocco|maroc|casablanca|rabat/i.test(profile?.location ?? ""))
  ) {
    targets.push({
      label: "Maroc (Tout le pays)",
      location: LINKEDIN_GEO_IDS.morocco.location,
      geoId: LINKEDIN_GEO_IDS.morocco.geoId,
    });
    targets.push({
      label: "Casablanca",
      location: "Casablanca, Morocco",
    });
    targets.push({
      label: "Rabat",
      location: "Rabat, Morocco",
    });
  }

  if (parsedLocs.wantsFrance) {
    targets.push({
      label: "France",
      location: LINKEDIN_GEO_IDS.france.location,
      geoId: LINKEDIN_GEO_IDS.france.geoId,
    });
  }

  if (parsedLocs.wantsEurope) {
    targets.push({
      label: "Europe",
      location: LINKEDIN_GEO_IDS.europe.location,
      geoId: LINKEDIN_GEO_IDS.europe.geoId,
    });
  }

  if (parsedLocs.wantsRemote) {
    targets.push({
      label: parsedLocs.wantsMorocco ? "Maroc (Remote / Hybride)" : "Remote",
      location: parsedLocs.wantsMorocco ? "Morocco" : "Worldwide",
      geoId: parsedLocs.wantsMorocco ? LINKEDIN_GEO_IDS.morocco.geoId : undefined,
      remoteFlag: true,
    });
  }

  if (targets.length === 0) {
    targets.push({
      label: "Maroc",
      location: LINKEDIN_GEO_IDS.morocco.location,
      geoId: LINKEDIN_GEO_IDS.morocco.geoId,
    });
  }

  const buildUrl = (opts: {
    keywords: string;
    location: string;
    geoId?: string;
    tprSeconds: number;
    remote?: boolean;
    includeExp?: boolean;
  }) => {
    const u = new URL("https://www.linkedin.com/jobs/search/");
    u.searchParams.set("keywords", opts.keywords);
    u.searchParams.set("location", opts.location);
    if (opts.geoId) {
      u.searchParams.set("geoId", opts.geoId);
    }
    u.searchParams.set("f_TPR", `r${opts.tprSeconds}`);
    if (opts.remote) {
      u.searchParams.set("f_WT", "2,3"); // Remote + Hybrid
    }
    if (opts.includeExp) {
      u.searchParams.set("f_E", expCode);
    }
    u.searchParams.set("sortBy", "DD"); // Most recent first
    return u.toString();
  };

  const presets: LinkedInProfileSearchPreset[] = [];
  const mainTarget = targets[0];

  // 1. Today's fresh offers matching exact profile title
  presets.push({
    id: "today-role-main",
    label: `${primaryTitle} — ${mainTarget.label}`,
    badge: "Aujourd'hui (24h)",
    keywords: primaryTitle,
    locationLabel: mainTarget.label,
    timeFilterLabel: "Dernières 24h",
    url: buildUrl({
      keywords: primaryTitle,
      location: mainTarget.location,
      geoId: mainTarget.geoId,
      tprSeconds: 86400,
      remote: mainTarget.remoteFlag,
      includeExp: true,
    }),
    matchedFrom: [primaryTitle, `${years} ans d'exp.`],
  });

  // 2. Past week role + top CV skills
  if (skillPair) {
    presets.push({
      id: "week-role-skills",
      label: `${primaryTitle} (${skillPair}) — ${mainTarget.label}`,
      badge: "Top Compétences CV",
      keywords: `${primaryTitle} ${skillPair}`,
      locationLabel: mainTarget.label,
      timeFilterLabel: "7 derniers jours",
      url: buildUrl({
        keywords: `${primaryTitle} ${skillPair}`,
        location: mainTarget.location,
        geoId: mainTarget.geoId,
        tprSeconds: 604800,
        remote: mainTarget.remoteFlag,
      }),
      matchedFrom: uniqueSkills.slice(0, 2),
    });
  }

  // 3. Secondary city / region presets (e.g., Casablanca & Rabat when Morocco is selected)
  for (const extraTarget of targets.slice(1, 4)) {
    presets.push({
      id: `city-${extraTarget.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label: `${primaryTitle} — ${extraTarget.label}`,
      badge: "7 derniers jours",
      keywords: primaryTitle,
      locationLabel: extraTarget.label,
      timeFilterLabel: "7 derniers jours",
      url: buildUrl({
        keywords: primaryTitle,
        location: extraTarget.location,
        geoId: extraTarget.geoId,
        tprSeconds: 604800,
        remote: extraTarget.remoteFlag,
      }),
      matchedFrom: [primaryTitle, extraTarget.label],
    });
  }

  // 4. Secondary skill stack search if available
  if (secondarySkillPair) {
    presets.push({
      id: "skills-cluster-2",
      label: `Stack ${secondarySkillPair} — ${mainTarget.label}`,
      badge: "Stack Technique",
      keywords: secondarySkillPair,
      locationLabel: mainTarget.label,
      timeFilterLabel: "7 derniers jours",
      url: buildUrl({
        keywords: secondarySkillPair,
        location: mainTarget.location,
        geoId: mainTarget.geoId,
        tprSeconds: 604800,
      }),
      matchedFrom: uniqueSkills.slice(2, 4),
    });
  }

  return presets.slice(0, 6);
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractMetaContent(html: string, key: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
      "i"
    ),
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m?.[1]) return decodeHtmlEntities(m[1]).trim();
  }
  return null;
}

export interface PublicJobUrlPreview {
  reachable: boolean;
  title?: string;
  company_name?: string;
  location?: string;
  country_code?: string | null;
  description?: string;
  canonical_url: string;
  is_linkedin: boolean;
  note?: string;
}

/**
 * Politely inspects public JSON-LD JobPosting / OpenGraph tags on a public job URL
 * without bypassing any authentication wall or scraping restricted pages.
 */
export async function inspectPublicJobOfferUrl(
  rawUrl: string
): Promise<PublicJobUrlPreview> {
  const safeUrl = isSafePublicHttpsUrl(rawUrl);
  if (!safeUrl) {
    throw new Error("Please provide a valid public https:// job URL.");
  }

  const isLinkedIn = /(^|\.)linkedin\.com$/i.test(safeUrl.hostname);
  const liJobId = isLinkedIn ? extractLinkedInJobId(safeUrl.toString()) : null;
  const canonicalUrl =
    isLinkedIn && liJobId
      ? `https://www.linkedin.com/jobs/view/${liJobId}/`
      : normalizeJobUrl(safeUrl.toString());

  try {
    const res = await fetch(canonicalUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; AIJobHunterPreview/1.0)",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return {
        reachable: false,
        canonical_url: canonicalUrl,
        is_linkedin: isLinkedIn,
        note: `Public page returned HTTP ${res.status}. Fill or paste the offer details below to import.`,
      };
    }

    const html = (await res.text()).slice(0, 350_000);

    // 1. Check structured schema.org JobPosting JSON-LD if publicly present
    const ldMatches = Array.from(
      html.matchAll(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
      )
    );

    for (const m of ldMatches) {
      try {
        const parsed = JSON.parse(m[1].trim());
        const candidates = Array.isArray(parsed)
          ? parsed
          : parsed?.["@graph"] && Array.isArray(parsed["@graph"])
            ? parsed["@graph"]
            : [parsed];

        const posting = candidates.find(
          (item: any) =>
            item &&
            (item["@type"] === "JobPosting" ||
              (Array.isArray(item["@type"]) &&
                item["@type"].includes("JobPosting")))
        );

        if (posting) {
          const title = String(posting.title ?? "").trim();
          const companyName = String(
            posting.hiringOrganization?.name ?? ""
          ).trim();
          const addr =
            posting.jobLocation?.address ??
            (Array.isArray(posting.jobLocation)
              ? posting.jobLocation[0]?.address
              : null);
          const locality = [addr?.addressLocality, addr?.addressRegion, addr?.addressCountry]
            .filter((x) => typeof x === "string" && x.trim())
            .join(", ");
          const countryCode =
            typeof addr?.addressCountry === "string" &&
            addr.addressCountry.trim().length === 2
              ? addr.addressCountry.trim().toUpperCase()
              : null;
          const desc = stripHtmlToText(String(posting.description ?? ""));

          if (title) {
            return {
              reachable: true,
              title: decodeHtmlEntities(title),
              company_name: companyName ? decodeHtmlEntities(companyName) : undefined,
              location: locality || undefined,
              country_code: countryCode,
              description: desc.slice(0, 12000),
              canonical_url: canonicalUrl,
              is_linkedin: isLinkedIn,
            };
          }
        }
      } catch {
        // Ignore malformed JSON-LD blocks
      }
    }

    // 2. Fallback to OpenGraph title / description (e.g. "Company hiring Role in Casablanca, Morocco | LinkedIn")
    const ogTitle =
      extractMetaContent(html, "og:title") ||
      decodeHtmlEntities(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "");
    const ogDesc =
      extractMetaContent(html, "og:description") ||
      extractMetaContent(html, "description") ||
      "";

    if (ogTitle && !/sign in|join linkedin|authwall/i.test(ogTitle)) {
      let parsedTitle = ogTitle.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
      let parsedCompany = "";
      let parsedLocation = "";

      // Common public LinkedIn OG pattern: "<Company> hiring <Title> in <Location>" or "<Company> recrute des profils de <Title> (<Location>)"
      const enHiring = parsedTitle.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+)$/i);
      const frHiring = parsedTitle.match(
        /^(.+?)\s+recrute(?:\s+des\s+profils\s+de)?\s+(.+?)\s*\((.+?)\)$/i
      );

      if (enHiring) {
        parsedCompany = enHiring[1].trim();
        parsedTitle = enHiring[2].trim();
        parsedLocation = enHiring[3].trim();
      } else if (frHiring) {
        parsedCompany = frHiring[1].trim();
        parsedTitle = frHiring[2].trim();
        parsedLocation = frHiring[3].trim();
      }

      return {
        reachable: true,
        title: parsedTitle || undefined,
        company_name: parsedCompany || undefined,
        location: parsedLocation || undefined,
        description: stripHtmlToText(ogDesc).slice(0, 8000) || undefined,
        canonical_url: canonicalUrl,
        is_linkedin: isLinkedIn,
      };
    }

    return {
      reachable: false,
      canonical_url: canonicalUrl,
      is_linkedin: isLinkedIn,
      note: "This URL requires sign-in to view full text. Paste the job title, company, and description below to score and automate it.",
    };
  } catch {
    return {
      reachable: false,
      canonical_url: canonicalUrl,
      is_linkedin: isLinkedIn,
      note: "Could not fetch preview automatically. Enter or paste the offer details below to import.",
    };
  }
}

export function buildImportedJobRecord(input: {
  url: string;
  title: string;
  company_name: string;
  location: string;
  description: string;
  public_recruitment_email?: string | null;
  is_remote?: boolean;
  contract_type?: string;
}): DiscoveredJobInput {
  const safeUrl = isSafePublicHttpsUrl(input.url);
  const cleanUrl = safeUrl ? safeUrl.toString() : input.url.trim();
  const isLinkedIn = safeUrl
    ? /(^|\.)linkedin\.com$/i.test(safeUrl.hostname)
    : /linkedin\.com/i.test(cleanUrl);
  const liId = isLinkedIn ? extractLinkedInJobId(cleanUrl) : null;

  const cleanDesc = stripHtmlToText(input.description || "").slice(0, 12000);
  const fullText = `${input.title}\n${cleanDesc}`;
  const explicitEmail =
    input.public_recruitment_email?.trim() ||
    extractPublishedRecruitmentEmail(cleanDesc);

  const loc = input.location.trim() || "Morocco";
  const countryCode = /\b(morocco|maroc|casablanca|rabat|tanger|tangier|marrakech|fes|f[eè]s|agadir|oujda|kenitra|tetouan)\b/i.test(
    loc
  )
    ? "MA"
    : /\b(france|paris|lyon|nantes|toulouse|bordeaux|lille)\b/i.test(loc)
      ? "FR"
      : null;

  return {
    external_id: liId ? `li:${liId}` : `import:${normalizeJobUrl(cleanUrl)}`,
    source: isLinkedIn ? "linkedin_import" : "external_import",
    title: input.title.trim(),
    company_name: input.company_name.trim(),
    company_website: null,
    company_careers_page: cleanUrl,
    company_ats_provider: "direct",
    company_ats_slug: null,
    location: loc,
    country_code: countryCode,
    is_remote:
      Boolean(input.is_remote) ||
      /\b(remote|t[eé]l[eé]travail)\b/i.test(`${loc} ${input.title}`),
    contract_type: input.contract_type || "full_time",
    sector: inferJobSector(input.title, cleanDesc),
    description: cleanDesc,
    required_skills: extractSkillsFromJobText(fullText),
    experience_requirements: extractExperienceRequirements(cleanDesc),
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_text: null,
    detected_language: detectTextLanguage(fullText),
    public_recruitment_email: explicitEmail || null,
    application_url: cleanUrl,
    published_at: new Date().toISOString(),
    application_deadline: null,
    raw_metadata: {
      imported_via: isLinkedIn ? "linkedin_profile_workflow" : "manual_url_import",
    },
  };
}
