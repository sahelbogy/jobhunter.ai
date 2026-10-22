import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, _opts: any) => ({
    auth: {
      getUser: async () => ({
        data: { user: (globalThis as any).__MOCK_AUTH_USER ?? null },
      }),
    },
  }),
}));

vi.mock("@/lib/security/auth-guard", () => ({
  requireAuthenticatedUser: async () => ({
    ok: true,
    user: { id: "user-test-123", email: "user@example.com" },
    supabase: (globalThis as any).__MOCK_USER_SUPABASE,
  }),
}));

import { updateSession } from "@/lib/supabase/middleware";
import { GET as applicationsGetHandler } from "@/app/api/applications/route";
import { GET as analyticsHandler } from "@/app/api/analytics/route";

describe("Auth Middleware, RLS Schema Isolation, Tracker CSV Export & Analytics", () => {
  it("redirects unauthenticated visitors from protected workspace pages to /login while keeping public pages open", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://xcwkhyrtariggnlswxjd.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    (globalThis as any).__MOCK_AUTH_USER = null;

    const protectedReq = new NextRequest(
      "https://jobhunterai-five.vercel.app/dashboard"
    );
    const protectedRes = await updateSession(protectedReq);
    expect(protectedRes.status).toBe(307);
    expect(protectedRes.headers.get("location")).toContain(
      "/login"
    );

    const publicPrivacyReq = new NextRequest(
      "https://jobhunterai-five.vercel.app/privacy"
    );
    const publicPrivacyRes = await updateSession(publicPrivacyReq);
    expect(publicPrivacyRes.status).toBe(200);

    // Authenticated user visiting /login redirects to /dashboard
    (globalThis as any).__MOCK_AUTH_USER = { id: "user-test-123" };
    const loginWhenAuthed = new NextRequest(
      "https://jobhunterai-five.vercel.app/login"
    );
    const loginRedirectRes = await updateSession(loginWhenAuthed);
    expect(loginRedirectRes.status).toBe(307);
    expect(loginRedirectRes.headers.get("location")).toContain("/dashboard");
  });

  it("enforces Row Level Security across all 13 required tables and private Storage buckets in SQL migration", () => {
    const migrationPath = path.join(
      process.cwd(),
      "supabase/migrations/20261022000001_initial_schema.sql"
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    const requiredTables = [
      "profiles",
      "resumes",
      "user_preferences",
      "companies",
      "jobs",
      "job_matches",
      "applications",
      "application_documents",
      "email_connections",
      "email_logs",
      "automation_settings",
      "automation_runs",
      "ai_generation_logs",
    ];

    for (const table of requiredTables) {
      expect(sql).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`
      );
    }

    expect(sql).toContain("'resumes', 'resumes', FALSE");
    expect(sql).toContain(
      "'application-documents', 'application-documents', FALSE"
    );
    expect(sql).toContain("(storage.foldername(name))[1] = auth.uid()::text");
  });

  it("exports Application Tracker records accurately as RFC 4180 CSV", async () => {
    (globalThis as any).__MOCK_USER_SUPABASE = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: async () => ({
              data: [
                {
                  company_name: 'SQLI "Digital" Maroc',
                  job_title: "Senior TypeScript Engineer",
                  location: "Casablanca, MA",
                  job_url: "https://jobs.smartrecruiters.com/SQLI1/1",
                  match_score: 88,
                  tracking_status: "interview",
                  approval_status: "sent",
                  language: "fr",
                  recipient_email: "recrutement@sqli.com",
                  email_delivery_result: "Sent via Gmail",
                  applied_at: "2026-10-22T09:00:00Z",
                  follow_up_date: "2026-10-29",
                  notes: "Technical interview scheduled",
                  created_at: "2026-10-21T12:00:00Z",
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    };

    const req = new NextRequest(
      "https://jobhunterai-five.vercel.app/api/applications?format=csv"
    );
    const res = await applicationsGetHandler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain('"SQLI ""Digital"" Maroc"');
    expect(csv).toContain('"Senior TypeScript Engineer"');
    expect(csv).toContain('"interview"');
  });

  it("computes real database-backed Analytics metrics without fabricated numbers", async () => {
    const mockTableData: Record<string, Array<any>> = {
      jobs: [
        {
          id: "j1",
          source: "remotive",
          sector: "FinTech",
          discovered_at: "2026-10-20T10:00:00Z",
          is_remote: true,
        },
        {
          id: "j2",
          source: "smartrecruiters",
          sector: "FinTech",
          discovered_at: "2026-10-21T10:00:00Z",
          is_remote: false,
        },
      ],
      job_matches: [
        { id: "m1", match_score: 88, created_at: "2026-10-20T10:05:00Z" },
        { id: "m2", match_score: 52, created_at: "2026-10-21T10:05:00Z" },
      ],
      applications: [
        {
          id: "a1",
          company_name: "SQLI",
          job_title: "Senior Engineer",
          tracking_status: "interview",
          approval_status: "sent",
          match_score: 88,
          created_at: "2026-10-21T11:00:00Z",
          sent_at: "2026-10-21T11:15:00Z",
          updated_at: "2026-10-21T11:15:00Z",
        },
      ],
      email_logs: [
        {
          id: "e1",
          status: "sent",
          recipient_email: "recrutement@sqli.com",
          subject: "Candidature",
          created_at: "2026-10-21T11:15:00Z",
        },
      ],
      automation_runs: [
        {
          id: "r1",
          trigger_type: "manual",
          status: "completed",
          jobs_discovered: 2,
          drafts_generated: 1,
          started_at: "2026-10-21T07:00:00Z",
        },
      ],
    };

    const makeBuilder = (table: string) => {
      const rows = mockTableData[table] ?? [];
      const chain: any = {
        eq: () => chain,
        order: () => chain,
        limit: async () => ({ data: rows, error: null }),
        then: (resolve: any) => resolve({ data: rows, error: null }),
      };
      return { select: () => chain };
    };

    (globalThis as any).__MOCK_USER_SUPABASE = {
      from: (table: string) => makeBuilder(table),
    };

    const res = await analyticsHandler();
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.kpis.jobsDiscovered).toBe(2);
    expect(payload.kpis.relevantMatches).toBe(1);
    expect(payload.kpis.applicationsSent).toBe(1);
    expect(payload.kpis.interviews).toBe(1);
    expect(payload.kpis.conversionToInterviewPct).toBe(100);
  });
});
