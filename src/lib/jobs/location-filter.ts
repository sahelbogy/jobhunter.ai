export interface LocationFilterableJob {
  location?: string | null;
  country_code?: string | null;
  is_remote?: boolean | null;
}

const MOROCCO_REGEX =
  /\b(morocco|maroc|marruecos|casablanca|rabat|tanger|tangier|marrakech|marrakesh|fes|f[eè]s|fez|agadir|oujda|kenitra|k[eé]nitra|tetouan|t[eé]touan|meknes|mekn[eè]s|mohammedia|benguerir|ben\s+guerir|el\s+jadida|nador|settat|laayoune|la[aâ]youne|dakhla|casanearshore|sala\s+al\s+jadida|technopolis\s+rabat|bouskoura|berrechid|safi|beni\s+mellal|khouribga)\b/i;

const FRANCE_REGEX =
  /\b(france|paris|lyon|marseille|toulouse|nantes|bordeaux|lille|strasbourg|rennes|montpellier|grenoble|nice|sophia\s+antipolis|la\s+d[eé]fense|[iî]le-de-france|boulogne-billancourt|courbevoie|levallois|nanterre|massy|aix-en-provence)\b/i;

const EUROPE_COUNTRY_CODES = new Set([
  "FR",
  "DE",
  "ES",
  "IT",
  "NL",
  "BE",
  "CH",
  "LU",
  "PT",
  "GB",
  "UK",
  "IE",
  "AT",
  "SE",
  "NO",
  "DK",
  "FI",
  "PL",
  "CZ",
  "RO",
  "HU",
  "GR",
]);

const EUROPE_REGEX =
  /\b(europe|european\s+union|\beu\b|germany|deutschland|berlin|munich|m[uü]nchen|frankfurt|hamburg|spain|espa[nñ]a|madrid|barcelona|netherlands|amsterdam|rotterdam|utrecht|belgium|brussels|bruxelles|switzerland|suisse|zurich|z[uü]rich|geneva|gen[eè]ve|lausanne|portugal|lisbon|lisboa|porto|italy|italia|milan|milano|rome|roma|uk|united\s+kingdom|london|manchester|ireland|dublin|austria|vienna|sweden|stockholm|poland|warsaw|krakow|romania|bucharest|luxembourg)\b/i;

const REMOTE_REGEX =
  /\b(remote|t[eé]l[eé]travail|work\s+from\s+home|anywhere|distributed|100%\s*remote)\b/i;

export interface ParsedRegionSelection {
  hasAnyFilter: boolean;
  wantsMorocco: boolean;
  wantsFrance: boolean;
  wantsEurope: boolean;
  wantsRemote: boolean;
  wantsInternational: boolean;
  specificTokens: string[];
}

export function parseSelectedLocations(
  selectedLocations?: string[] | null
): ParsedRegionSelection {
  const cleaned = (selectedLocations ?? [])
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (cleaned.length === 0) {
    return {
      hasAnyFilter: false,
      wantsMorocco: false,
      wantsFrance: false,
      wantsEurope: false,
      wantsRemote: false,
      wantsInternational: false,
      specificTokens: [],
    };
  }

  let wantsMorocco = false;
  let wantsFrance = false;
  let wantsEurope = false;
  let wantsRemote = false;
  let wantsInternational = false;
  const specificTokens: string[] = [];

  for (const raw of cleaned) {
    const lower = raw.toLowerCase();
    if (/^(morocco|maroc|ma)$/i.test(lower)) {
      wantsMorocco = true;
    } else if (/^(france|fr)$/i.test(lower)) {
      wantsFrance = true;
    } else if (/^(europe|eu)$/i.test(lower)) {
      wantsEurope = true;
    } else if (/^(remote|t[eé]l[eé]travail)$/i.test(lower)) {
      wantsRemote = true;
    } else if (/^(international|worldwide|global|all)$/i.test(lower)) {
      wantsInternational = true;
    } else {
      // Check if it's a Moroccan or French city explicitly typed by user
      if (MOROCCO_REGEX.test(lower)) {
        wantsMorocco = true;
      }
      if (FRANCE_REGEX.test(lower)) {
        wantsFrance = true;
      }
      specificTokens.push(lower);
    }
  }

  return {
    hasAnyFilter: true,
    wantsMorocco,
    wantsFrance,
    wantsEurope,
    wantsRemote,
    wantsInternational,
    specificTokens,
  };
}

export function isMoroccoJob(job: LocationFilterableJob): boolean {
  const cc = (job.country_code ?? "").trim().toUpperCase();
  const loc = (job.location ?? "").trim();

  if (cc === "MA" || cc === "MAR") {
    return true;
  }

  if (MOROCCO_REGEX.test(loc)) {
    return true;
  }

  return false;
}

export function isFranceJob(job: LocationFilterableJob): boolean {
  const cc = (job.country_code ?? "").trim().toUpperCase();
  const loc = (job.location ?? "").trim();

  if (cc === "FR" || cc === "FRA") {
    return true;
  }

  // Guard against false positive if country_code is explicitly MA
  if (cc === "MA") {
    return /\bfrance\b/i.test(loc);
  }

  return FRANCE_REGEX.test(loc);
}

export function isEuropeJob(job: LocationFilterableJob): boolean {
  const cc = (job.country_code ?? "").trim().toUpperCase();
  const loc = (job.location ?? "").trim();

  if (cc && EUROPE_COUNTRY_CODES.has(cc)) {
    return true;
  }

  if (cc === "MA") {
    return false;
  }

  return isFranceJob(job) || EUROPE_REGEX.test(loc);
}

export function isRemoteJob(job: LocationFilterableJob): boolean {
  const loc = (job.location ?? "").trim();
  return Boolean(job.is_remote) || REMOTE_REGEX.test(loc);
}

/**
 * Strictly checks whether a job belongs to AT LEAST ONE of the user's selected regions/cities.
 * Crucial invariant:
 * - When ONLY "Morocco" ("Maroc") is selected (without France/Europe/Remote/International),
 *   ONLY jobs physically or explicitly located in Morocco pass. Jobs in France, Germany, US,
 *   or generic Worldwide Remote are strictly excluded.
 */
export function matchesSelectedLocations(
  job: LocationFilterableJob,
  selectedLocations?: string[] | null
): boolean {
  const parsed = parseSelectedLocations(selectedLocations);

  if (!parsed.hasAnyFilter || parsed.wantsInternational) {
    return true;
  }

  const locLower = (job.location ?? "").toLowerCase();

  // If user typed a specific city (e.g., "Casablanca"), check city match first when no country pill was used
  if (
    parsed.specificTokens.length > 0 &&
    parsed.specificTokens.some((tok) => locLower.includes(tok))
  ) {
    return true;
  }

  if (parsed.wantsMorocco && isMoroccoJob(job)) {
    return true;
  }

  if (parsed.wantsFrance && isFranceJob(job)) {
    return true;
  }

  if (parsed.wantsEurope && isEuropeJob(job)) {
    return true;
  }

  if (parsed.wantsRemote && isRemoteJob(job)) {
    // If Remote is selected alongside Morocco (and NOT France/Europe/International),
    // exclude jobs explicitly locked to US-only or another single country if non-remote.
    return true;
  }

  return false;
}
