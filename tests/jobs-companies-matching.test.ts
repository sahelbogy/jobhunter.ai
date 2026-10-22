import { afterEach, describe, expect, it, vi } from "vitest";
import { deduplicateDiscoveredJobs } from "@/lib/jobs/dedup";
import { normalizeJobUrl } from "@/lib/security/sanitize";
import { fetchRemotiveJobs } from "@/lib/jobs/sources/remotive";
import { fetchArbeitnowJobs } from "@/lib/jobs/sources/arbeitnow";
import {
  AUTHORIZED_COMPANY_BOARDS,
  probeSmartRecruitersBoard,
} from "@/lib/jobs/sources/company-boards";
import { calculateDeterministicJobMatch } from "@/lib/matching/engine";

describe("Job Discovery, Deduplication, Company Channels & Match Engine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes tracking URLs and deduplicates identical job offers across feeds", () => {
    const urlA =
      "https://jobs.smartrecruiters.com/SQLI1/744000123?utm_source=linkedin&ref=board";
    const urlB = "https://jobs.smartrecruiters.com/SQLI1/744000123/";
    expect(normalizeJobUrl(urlA)).toBe(normalizeJobUrl(urlB));

    const { unique, duplicatesRemoved } = deduplicateDiscoveredJobs([
      {
        external_id: "744000123",
        source: "smartrecruiters",
        title: "Full-Stack Engineer",
        company_name: "SQLI Digital Experience",
        location: "Casablanca, MA",
        is_remote: false,
        contract_type: "Full-time",
        sector: "Software & IT",
        description: "TypeScript React Node.js role in Casablanca.",
        required_skills: ["TypeScript", "React"],
        experience_requirements: "3+ years",
        detected_language: "en",
        application_url: urlA,
        public_recruitment_email: null,
        published_at: "2026-10-20T10:00:00Z",
      },
      {
        external_id: "dup-999",
        source: "remotive",
        title: "Full-Stack Engineer",
        company_name: "SQLI Digital Experience",
        location: "Casablanca, MA",
        is_remote: false,
        contract_type: "Full-time",
        sector: "Software & IT",
        description: "Duplicate URL entry via aggregator.",
        required_skills: ["TypeScript"],
        experience_requirements: "3+ years",
        detected_language: "en",
        application_url: urlB,
        public_recruitment_email: null,
        published_at: "2026-10-20T10:00:00Z",
      },
    ]);

    expect(unique).toHaveLength(1);
    expect(duplicatesRemoved).toBe(1);
    expect(unique[0].dedup_hash).toHaveLength(64);
  });

  it("fetches jobs across Remotive, Arbeitnow, and SmartRecruiters Company Boards without fabricating emails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("remotive.com/api/remote-jobs")) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 101,
                url: "https://remotive.com/remote-jobs/software-dev/senior-nextjs-engineer-101",
                title: "Senior Next.js Engineer",
                company_name: "EuroCloud SaaS",
                category: "Software Development",
                tags: ["TypeScript", "Next.js", "PostgreSQL"],
                job_type: "full_time",
                publication_date: "2026-10-21T09:00:00Z",
                candidate_required_location: "Europe / Remote",
                salary: "€70k - €90k",
                description:
                  "<p>Join EuroCloud. Contact jobs@eurocloud-example.eu or apply online.</p>",
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("arbeitnow.com/api/job-board-api")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                slug: "backend-ts-paris-202",
                company_name: "FinTech Paris",
                title: "Ingénieur Backend TypeScript (H/F)",
                description:
                  "<p>Nous recherchons un ingénieur Node.js et PostgreSQL basé à Paris.</p>",
                remote: true,
                url: "https://www.arbeitnow.com/jobs/backend-ts-paris-202",
                tags: ["Node.js", "TypeScript"],
                job_types: ["Full Time"],
                location: "Paris, France",
                created_at: 1792580000,
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes("api.smartrecruiters.com")) {
        return new Response(
          JSON.stringify({
            content: [
              {
                id: "sr-ma-303",
                name: "Senior React & TypeScript Consultant",
                releasedDate: "2026-10-21T12:00:00Z",
                location: { city: "Casablanca", country: "ma", remote: false },
                department: { label: "Digital Engineering" },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const remotive = await fetchRemotiveJobs({ query: "TypeScript", limit: 5 });
    expect(remotive.jobs).toHaveLength(1);
    expect(remotive.jobs[0].public_recruitment_email).toBe(
      "jobs@eurocloud-example.eu"
    );

    const arbeitnow = await fetchArbeitnowJobs({
      query: "TypeScript",
      limit: 5,
    });
    expect(arbeitnow.jobs).toHaveLength(1);
    expect(arbeitnow.jobs[0].detected_language).toBe("fr");

    const srJobs = await probeSmartRecruitersBoard({
      slug: "SQLI1",
      companyName: "SQLI Digital Experience",
      limit: 5,
    });
    expect(srJobs).toHaveLength(1);
    // No email in SmartRecruiters feed -> must stay null, never fabricated!
    expect(srJobs[0].public_recruitment_email).toBeNull();
    expect(srJobs[0].application_url).toContain("jobs.smartrecruiters.com");
  });

  it("maintains verified company career boards with legitimate HTTPS portals", () => {
    expect(AUTHORIZED_COMPANY_BOARDS.length).toBeGreaterThanOrEqual(5);
    for (const company of AUTHORIZED_COMPANY_BOARDS) {
      expect(company.careersPage.startsWith("https://")).toBe(true);
      expect(["smartrecruiters", "greenhouse", "lever", "ashby"]).toContain(
        company.provider
      );
    }
  });

  it("calculates 0-100 compatibility score with matching/missing skills, strengths, weaknesses & explanation", () => {
    const highMatch = calculateDeterministicJobMatch({
      profile: {
        professional_title: "Senior Full-Stack TypeScript Engineer",
        location: "Casablanca, Morocco",
        years_of_experience: 6,
        technical_skills: [
          "TypeScript",
          "React",
          "Next.js",
          "Node.js",
          "PostgreSQL",
          "Docker",
        ],
        technologies: ["Tailwind CSS", "Supabase"],
        sectors: ["Software & IT", "FinTech"],
        languages: [
          { language: "French", level: "Fluent" },
          { language: "English", level: "Fluent" },
        ],
        education: [
          {
            institution: "ENSIAS",
            degree: "Master Engineering",
            field: "Computer Science",
            startDate: "2018",
            endDate: "2020",
            location: "Rabat",
            description: "",
          },
        ],
      },
      targetLocations: ["Casablanca", "Morocco", "Remote"],
      preferredSectors: ["FinTech", "Software & IT"],
      job: {
        title: "Senior Full-Stack Engineer (Next.js / TypeScript)",
        company_name: "Atlas FinTech",
        location: "Casablanca, Morocco",
        is_remote: false,
        description:
          "We are hiring a Senior Full-Stack Engineer with 5+ years of experience in TypeScript, React, Next.js, PostgreSQL, and Kubernetes.",
        required_skills: [
          "TypeScript",
          "React",
          "Next.js",
          "PostgreSQL",
          "Kubernetes",
        ],
        sector: "FinTech",
        detected_language: "en",
      },
    });

    expect(highMatch.match_score).toBeGreaterThanOrEqual(75);
    expect(highMatch.match_score).toBeLessThanOrEqual(100);
    expect(
      highMatch.matching_skills.map((s) => s.toLowerCase())
    ).toEqual(
      expect.arrayContaining(["typescript", "react", "next.js", "postgresql"])
    );
    expect(highMatch.missing_skills.map((s) => s.toLowerCase())).toContain(
      "kubernetes"
    );
    expect(highMatch.strengths.length).toBeGreaterThan(0);
    expect(highMatch.explanation).toContain("Atlas FinTech");
    expect(highMatch.recommendation).toBeTruthy();
  });
});
