import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import {
  AUTHORIZED_COMPANY_BOARDS,
  probeAshbyBoard,
  probeGreenhouseBoard,
  probeLeverBoard,
  probeSmartRecruitersBoard,
} from "@/lib/jobs/sources/company-boards";
import {
  deduplicateDiscoveredJobs,
  normalizeCompanyName,
} from "@/lib/jobs/dedup";
import { validateRecipientEmail } from "@/lib/security/sanitize";

// Curated reference employers in Morocco, France & Europe with verified official careers portals
const REFERENCE_SPONTANEOUS_COMPANIES = [
  {
    name: "OCP Group",
    industry: "Industrial Engineering, Data & Agritech",
    website: "https://www.ocpgroup.ma",
    location: "Casablanca / Benguerir, Morocco",
    careers_page: "https://careers.ocpgroup.ma",
    description:
      "Global plant nutrition and industrial leader headquartered in Casablanca with digital, AI, and engineering programs via UM6P & OCP Digital.",
    application_method: "spontaneous_application" as const,
  },
  {
    name: "Capgemini Engineering Morocco & France",
    industry: "Software Engineering, Cloud & Consulting",
    website: "https://www.capgemini.com",
    location: "Casablanca, Rabat & Paris",
    careers_page: "https://www.capgemini.com/careers/",
    description:
      "Global consulting and engineering services group operating major delivery centers in Casablancashore, Technopolis Rabat, and across France.",
    application_method: "spontaneous_application" as const,
  },
  {
    name: "Orange Maroc & Orange Business",
    industry: "Telecommunications, Cloud & Cybersecurity",
    website: "https://www.orange.ma",
    location: "Casablanca, Morocco / Paris, France",
    careers_page: "https://orange.jobs",
    description:
      "Telecom and digital services operator recruiting software, network, cloud, data, and cybersecurity engineers via its official Orange Jobs portal.",
    application_method: "spontaneous_application" as const,
  },
  {
    name: "Inwi (Wana Corporate)",
    industry: "Telecommunications & FinTech (inwi money)",
    website: "https://www.inwi.ma",
    location: "Casablanca, Morocco",
    careers_page: "https://www.inwi.ma/entreprise/carrieres",
    description:
      "Moroccan digital and telecom operator offering careers across cloud, software, product, and digital financial services.",
    application_method: "unverified_channel" as const,
  },
];

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { searchParams } = new URL(request.url);
  const method = searchParams.get("method") ?? "all";
  const q = searchParams.get("q")?.trim().toLowerCase() ?? "";

  // Ensure curated directory baselines exist in the user's company research workspace
  const { count } = await supabase
    .from("companies")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if ((count ?? 0) === 0) {
    const initialRows = [
      ...AUTHORIZED_COMPANY_BOARDS.map((b) => ({
        user_id: user.id,
        name: b.name,
        normalized_name: normalizeCompanyName(b.name),
        industry: b.industry,
        website: b.website,
        location: b.regions
          .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
          .join(", "),
        careers_page: b.careersPage,
        ats_provider: b.provider,
        ats_slug: b.slug,
        public_recruitment_email: null,
        description: b.description,
        application_method: "published_vacancies" as const,
        vacancies_count: 0,
        matching_sectors: [b.industry],
      })),
      ...REFERENCE_SPONTANEOUS_COMPANIES.map((c) => ({
        user_id: user.id,
        name: c.name,
        normalized_name: normalizeCompanyName(c.name),
        industry: c.industry,
        website: c.website,
        location: c.location,
        careers_page: c.careers_page,
        ats_provider: "direct",
        ats_slug: null,
        public_recruitment_email: null,
        description: c.description,
        application_method: c.application_method,
        vacancies_count: 0,
        matching_sectors: [c.industry],
      })),
    ];

    await supabase
      .from("companies")
      .upsert(initialRows, { onConflict: "user_id,normalized_name" });
  }

  let query = supabase
    .from("companies")
    .select("*")
    .eq("user_id", user.id)
    .order("vacancies_count", { ascending: false })
    .order("name", { ascending: true });

  if (
    method === "published_vacancies" ||
    method === "spontaneous_application" ||
    method === "unverified_channel"
  ) {
    query = query.eq("application_method", method);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const companies = (data ?? []).filter((c) => {
    if (!q) return true;
    const hay = `${c.name} ${c.industry} ${c.location} ${c.description}`.toLowerCase();
    return hay.includes(q);
  });

  return NextResponse.json({ companies });
}

const ProbeOrCreateCompanySchema = z.object({
  name: z.string().min(2).max(140),
  industry: z.string().max(120).optional().default("Technology"),
  website: z.string().url().optional().or(z.literal("")),
  location: z.string().max(120).optional().default(""),
  careers_page: z.string().url().optional().or(z.literal("")),
  ats_provider: z
    .enum(["smartrecruiters", "greenhouse", "lever", "ashby", "direct"])
    .optional(),
  ats_slug: z.string().max(80).optional(),
  public_recruitment_email: z.string().max(254).optional().or(z.literal("")),
  application_method: z
    .enum([
      "published_vacancies",
      "spontaneous_application",
      "unverified_channel",
    ])
    .optional(),
  description: z.string().max(1000).optional().default(""),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    const body = ProbeOrCreateCompanySchema.parse(await request.json());

    let verifiedEmail: string | null = null;
    if (body.public_recruitment_email?.trim()) {
      const check = validateRecipientEmail(body.public_recruitment_email);
      if (!check.valid) {
        return NextResponse.json(
          { error: `Invalid recruitment email: ${check.reason}` },
          { status: 400 }
        );
      }
      verifiedEmail = check.normalized;
    }

    let discoveredJobs = [] as Awaited<
      ReturnType<typeof probeGreenhouseBoard>
    >;
    if (
      body.ats_provider &&
      body.ats_provider !== "direct" &&
      body.ats_slug?.trim()
    ) {
      const slug = body.ats_slug.trim();
      if (body.ats_provider === "smartrecruiters") {
        discoveredJobs = await probeSmartRecruitersBoard({
          slug,
          companyName: body.name,
          website: body.website || undefined,
          limit: 25,
        });
      } else if (body.ats_provider === "greenhouse") {
        discoveredJobs = await probeGreenhouseBoard({
          slug,
          companyName: body.name,
          website: body.website || undefined,
          limit: 25,
        });
      } else if (body.ats_provider === "lever") {
        discoveredJobs = await probeLeverBoard({
          slug,
          companyName: body.name,
          website: body.website || undefined,
          limit: 25,
        });
      } else if (body.ats_provider === "ashby") {
        discoveredJobs = await probeAshbyBoard({
          slug,
          companyName: body.name,
          website: body.website || undefined,
          limit: 25,
        });
      }
    }

    if (!verifiedEmail) {
      verifiedEmail =
        discoveredJobs.find((j) => j.public_recruitment_email)
          ?.public_recruitment_email ?? null;
    }

    const method =
      discoveredJobs.length > 0
        ? "published_vacancies"
        : body.application_method ??
          (body.careers_page || verifiedEmail
            ? "spontaneous_application"
            : "unverified_channel");

    const norm = normalizeCompanyName(body.name);
    const { data: company, error: compErr } = await supabase
      .from("companies")
      .upsert(
        {
          user_id: user.id,
          name: body.name.trim(),
          normalized_name: norm,
          industry: body.industry,
          website: body.website || null,
          location:
            body.location ||
            discoveredJobs[0]?.location ||
            "International",
          careers_page:
            body.careers_page ||
            discoveredJobs[0]?.company_careers_page ||
            null,
          ats_provider: body.ats_provider ?? "direct",
          ats_slug: body.ats_slug?.trim() || null,
          public_recruitment_email: verifiedEmail,
          description:
            body.description ||
            `Company tracked via ${body.ats_provider ?? "direct career portal"}.`,
          application_method: method,
          vacancies_count: discoveredJobs.length,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "user_id,normalized_name" }
      )
      .select("*")
      .single();

    if (compErr) {
      return NextResponse.json({ error: compErr.message }, { status: 400 });
    }

    // Persist any live vacancies discovered from that company's official ATS board
    if (discoveredJobs.length > 0 && company) {
      const { unique } = deduplicateDiscoveredJobs(discoveredJobs);
      const jobRows = unique.map((j) => ({
        user_id: user.id,
        company_id: company.id,
        external_id: j.external_id,
        dedup_hash: j.dedup_hash,
        source: j.source,
        title: j.title,
        company_name: company.name,
        location: j.location,
        country_code: j.country_code ?? null,
        is_remote: j.is_remote,
        contract_type: j.contract_type,
        sector: j.sector,
        description: j.description,
        required_skills: j.required_skills,
        experience_requirements: j.experience_requirements,
        salary_min: j.salary_min ?? null,
        salary_max: j.salary_max ?? null,
        salary_currency: j.salary_currency ?? null,
        salary_text: j.salary_text ?? null,
        detected_language: j.detected_language,
        public_recruitment_email: j.public_recruitment_email ?? null,
        application_url: j.application_url,
        normalized_url: j.normalized_url,
        published_at: j.published_at ?? null,
      }));
      await supabase
        .from("jobs")
        .upsert(jobRows, { onConflict: "user_id,dedup_hash" });
    }

    return NextResponse.json({
      company,
      vacanciesImported: discoveredJobs.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid company payload." },
      { status: 400 }
    );
  }
}
