import crypto from "crypto";
import type { DiscoveredJobInput } from "@/types/domain";
import { normalizeJobUrl } from "@/lib/security/sanitize";

const SKILL_DICTIONARY: Array<{ canonical: string; regex: RegExp }> = [
  { canonical: "Python", regex: /\bpython\b/i },
  { canonical: "TypeScript", regex: /\btypescript\b/i },
  { canonical: "JavaScript", regex: /\bjavascript\b|\bjs\b/i },
  { canonical: "React", regex: /\breact(?:\.js|js)?\b/i },
  { canonical: "Next.js", regex: /\bnext(?:\.js|js)\b/i },
  { canonical: "Node.js", regex: /\bnode(?:\.js|js)?\b/i },
  { canonical: "Angular", regex: /\bangular\b/i },
  { canonical: "Vue.js", regex: /\bvue(?:\.js|js)?\b/i },
  { canonical: "Java", regex: /\bjava\b/i },
  { canonical: "Spring Boot", regex: /\bspring(?:\s*boot)?\b/i },
  { canonical: "C#", regex: /\bc#|\.net|dotnet\b/i },
  { canonical: "Go", regex: /\bgolang\b|\bgo\s+(?:engineer|developer|backend)\b/i },
  { canonical: "Rust", regex: /\brust\b/i },
  { canonical: "PHP", regex: /\bphp\b/i },
  { canonical: "Symfony", regex: /\bsymfony\b/i },
  { canonical: "Laravel", regex: /\blaravel\b/i },
  { canonical: "SQL", regex: /\bsql\b/i },
  { canonical: "PostgreSQL", regex: /\bpostgres(?:ql)?\b/i },
  { canonical: "MongoDB", regex: /\bmongodb\b/i },
  { canonical: "Redis", regex: /\bredis\b/i },
  { canonical: "Docker", regex: /\bdocker\b/i },
  { canonical: "Kubernetes", regex: /\bkubernetes|\bk8s\b/i },
  { canonical: "AWS", regex: /\baws\b|amazon web services/i },
  { canonical: "Azure", regex: /\bazure\b/i },
  { canonical: "GCP", regex: /\bgcp\b|google cloud/i },
  { canonical: "Terraform", regex: /\bterraform\b/i },
  { canonical: "CI/CD", regex: /\bci\/cd\b|gitlab ci|github actions|jenkins/i },
  { canonical: "GraphQL", regex: /\bgraphql\b/i },
  { canonical: "REST APIs", regex: /\brest(?:\s*api)?\b/i },
  { canonical: "Machine Learning", regex: /\bmachine learning\b|\bml\b|\bdeep learning\b/i },
  { canonical: "LLM / Generative AI", regex: /\bllm\b|generative ai|rag|openai|langchain/i },
  { canonical: "Data Analysis", regex: /\bdata analy(?:sis|tics)|analyse de donn[ée]es\b/i },
  { canonical: "Power BI", regex: /\bpower\s*bi\b/i },
  { canonical: "Tableau", regex: /\btableau\b/i },
  { canonical: "Spark", regex: /\bspark\b|pyspark/i },
  { canonical: "Snowflake", regex: /\bsnowflake\b/i },
  { canonical: "Playwright", regex: /\bplaywright\b/i },
  { canonical: "Selenium", regex: /\bselenium\b/i },
  { canonical: "Figma", regex: /\bfigma\b/i },
  { canonical: "Linux", regex: /\blinux\b/i },
  { canonical: "Agile / Scrum", regex: /\bagile\b|\bscrum\b/i },
];

export function extractSkillsFromJobText(
  text: string,
  existingTags: string[] = []
): string[] {
  const found = new Set<string>();
  for (const tag of existingTags) {
    const clean = tag.trim();
    if (clean && clean.length <= 36) {
      found.add(clean);
    }
  }
  for (const entry of SKILL_DICTIONARY) {
    if (entry.regex.test(text)) {
      found.add(entry.canonical);
    }
  }
  return Array.from(found).slice(0, 18);
}

export function extractExperienceRequirements(text: string): string {
  const m = text.match(
    /(\d{1,2}\s*(?:\+|à|-|to)?\s*\d{0,2}\s*(?:years?|ans?)\s+(?:of\s+)?(?:experience|d'exp[ée]rience)[^.\n]{0,60})/i
  );
  if (m?.[1]) return m[1].trim();
  if (/\bsenior\b|exp[ée]riment[ée]/i.test(text)) return "Senior (5+ years)";
  if (/\bjunior\b|d[ée]butant/i.test(text)) return "Junior (0-2 years)";
  if (/\bintern(?:ship)?\b|\bstage\b|\bstagiaire\b/i.test(text))
    return "Internship / Stage";
  return "Mid-level / Open";
}

export function inferJobSector(title: string, description: string): string {
  const combined = `${title} ${description.slice(0, 1000)}`;
  if (/\b(data|machine learning|ai|ia|analytics|bi|scientist)\b/i.test(combined)) {
    return "Data & Artificial Intelligence";
  }
  if (/\b(devops|cloud|sre|platform|infrastructure|kubernetes)\b/i.test(combined)) {
    return "Cloud & DevOps";
  }
  if (/\b(security|cyber|s[ée]curit[ée]|soc|pentest)\b/i.test(combined)) {
    return "Cybersecurity";
  }
  if (/\b(qa|test|quality|automaticien)\b/i.test(combined)) {
    return "Quality Assurance";
  }
  if (/\b(product|chef de projet|project manager|scrum)\b/i.test(combined)) {
    return "Product & Project Management";
  }
  if (/\b(design|ux|ui)\b/i.test(combined)) {
    return "Design & UX";
  }
  if (/\b(finance|fintech|account|audit|paie)\b/i.test(combined)) {
    return "Finance & Business";
  }
  if (/\b(sales|marketing|business development|account manager)\b/i.test(combined)) {
    return "Sales & Marketing";
  }
  return "Software Engineering";
}

export function normalizeCompanyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\b(inc|ltd|llc|corp|corporation|sas|sarl|sa|gmbh|group|groupe)\b\.?/gi, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function computeJobDedupHash(job: {
  source: string;
  external_id: string;
  application_url: string;
  company_name: string;
  title: string;
}): string {
  const normUrl = normalizeJobUrl(job.application_url);
  // Canonical identity prefers normalized URL when specific to a job path, falling back to source+external_id
  const urlHasSpecificPath = (() => {
    try {
      const u = new URL(normUrl);
      return u.pathname.length > 6;
    } catch {
      return false;
    }
  })();

  const basis = urlHasSpecificPath
    ? `url:${normUrl.toLowerCase()}`
    : `src:${job.source}:${job.external_id.trim().toLowerCase()}`;

  return crypto.createHash("sha256").update(basis, "utf8").digest("hex");
}

export function deduplicateDiscoveredJobs(
  jobs: DiscoveredJobInput[]
): { unique: Array<DiscoveredJobInput & { dedup_hash: string; normalized_url: string }>; duplicatesRemoved: number } {
  const seenHashes = new Set<string>();
  const seenSemantic = new Set<string>();
  const unique: Array<
    DiscoveredJobInput & { dedup_hash: string; normalized_url: string }
  > = [];
  let duplicatesRemoved = 0;

  for (const job of jobs) {
    const normalized_url = normalizeJobUrl(job.application_url);
    if (!normalized_url || !job.title.trim() || !job.company_name.trim()) {
      continue;
    }

    const dedup_hash = computeJobDedupHash({
      source: job.source,
      external_id: job.external_id,
      application_url: normalized_url,
      company_name: job.company_name,
      title: job.title,
    });

    const semanticKey = `${normalizeCompanyName(job.company_name)}|${job.title
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")}|${job.location.trim().toLowerCase()}`;

    if (seenHashes.has(dedup_hash) || seenSemantic.has(semanticKey)) {
      duplicatesRemoved += 1;
      continue;
    }

    seenHashes.add(dedup_hash);
    seenSemantic.add(semanticKey);
    unique.push({
      ...job,
      application_url: normalized_url,
      normalized_url,
      dedup_hash,
    });
  }

  return { unique, duplicatesRemoved };
}
