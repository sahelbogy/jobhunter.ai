import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const [
    { data: jobs },
    { data: matches },
    { data: applications },
    { data: emailLogs },
    { data: automationRuns },
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, source, sector, discovered_at, is_remote")
      .eq("user_id", user.id),
    supabase
      .from("job_matches")
      .select("id, match_score, created_at")
      .eq("user_id", user.id),
    supabase
      .from("applications")
      .select(
        "id, company_name, job_title, approval_status, tracking_status, match_score, created_at, sent_at, updated_at"
      )
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("email_logs")
      .select("id, status, recipient_email, subject, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("automation_runs")
      .select(
        "id, trigger_type, status, jobs_discovered, drafts_generated, started_at"
      )
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(10),
  ]);

  const jobList = jobs ?? [];
  const matchList = matches ?? [];
  const appList = applications ?? [];

  const relevantMatchesCount = matchList.filter(
    (m) => (m.match_score ?? 0) >= 65
  ).length;
  const approvedCount = appList.filter(
    (a) => a.approval_status === "approved" || a.approval_status === "sent"
  ).length;
  const sentCount = appList.filter(
    (a) =>
      a.approval_status === "sent" ||
      a.tracking_status === "sent" ||
      a.tracking_status === "applied_externally" ||
      a.tracking_status === "interview" ||
      a.tracking_status === "offer"
  ).length;
  const interviewsCount = appList.filter(
    (a) => a.tracking_status === "interview" || a.tracking_status === "offer"
  ).length;
  const offersCount = appList.filter(
    (a) => a.tracking_status === "offer"
  ).length;

  const kpis = {
    jobsDiscovered: jobList.length,
    relevantMatches: relevantMatchesCount,
    applicationsGenerated: appList.length,
    applicationsApproved: approvedCount,
    applicationsSent: sentCount,
    interviews: interviewsCount,
    offers: offersCount,
    awaitingApproval: appList.filter(
      (a) => a.approval_status === "awaiting_approval"
    ).length,
    conversionToInterviewPct:
      sentCount > 0 ? Math.round((interviewsCount / sentCount) * 100) : 0,
    conversionToOfferPct:
      sentCount > 0 ? Math.round((offersCount / sentCount) * 100) : 0,
  };

  // Build real 8-week activity series strictly from database timestamps
  const now = new Date();
  const weeklySeries: Array<{
    week: string;
    discovered: number;
    generated: number;
    sent: number;
  }> = [];

  for (let i = 7; i >= 0; i--) {
    const end = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const label = start.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    const discovered = jobList.filter((j) => {
      const t = new Date(j.discovered_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    }).length;

    const generated = appList.filter((a) => {
      const t = new Date(a.created_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    }).length;

    const sent = appList.filter((a) => {
      if (!a.sent_at) return false;
      const t = new Date(a.sent_at).getTime();
      return t >= start.getTime() && t < end.getTime();
    }).length;

    weeklySeries.push({ week: label, discovered, generated, sent });
  }

  // Build real 6-month series strictly from database records
  const monthlySeries: Array<{
    month: string;
    discovered: number;
    applications: number;
    interviews: number;
  }> = [];

  for (let m = 5; m >= 0; m--) {
    const refDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1)
    );
    const nextMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m + 1, 1)
    );
    const label = refDate.toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });

    const discovered = jobList.filter((j) => {
      const t = new Date(j.discovered_at).getTime();
      return t >= refDate.getTime() && t < nextMonth.getTime();
    }).length;

    const appsInMonth = appList.filter((a) => {
      const t = new Date(a.created_at).getTime();
      return t >= refDate.getTime() && t < nextMonth.getTime();
    });

    monthlySeries.push({
      month: label,
      discovered,
      applications: appsInMonth.length,
      interviews: appsInMonth.filter(
        (a) =>
          a.tracking_status === "interview" || a.tracking_status === "offer"
      ).length,
    });
  }

  // Outcomes distribution
  const outcomeCounts: Record<string, number> = {};
  for (const a of appList) {
    outcomeCounts[a.tracking_status] =
      (outcomeCounts[a.tracking_status] ?? 0) + 1;
  }
  const outcomes = Object.entries(outcomeCounts).map(([status, count]) => ({
    status,
    count,
  }));

  // Match score buckets
  const scoreBuckets = [
    {
      range: "80-100%",
      count: matchList.filter((m) => m.match_score >= 80).length,
    },
    {
      range: "65-79%",
      count: matchList.filter(
        (m) => m.match_score >= 65 && m.match_score < 80
      ).length,
    },
    {
      range: "45-64%",
      count: matchList.filter(
        (m) => m.match_score >= 45 && m.match_score < 65
      ).length,
    },
    {
      range: "0-44%",
      count: matchList.filter((m) => m.match_score < 45).length,
    },
  ];

  // Unified activity feed from real records
  const activity = [
    ...appList.slice(0, 8).map((a) => ({
      id: `app-${a.id}`,
      type: "application",
      title: `${a.company_name} — ${a.job_title}`,
      detail: `Approval: ${a.approval_status} • Tracking: ${a.tracking_status}`,
      timestamp: a.updated_at,
    })),
    ...(emailLogs ?? []).slice(0, 6).map((e) => ({
      id: `email-${e.id}`,
      type: "email",
      title: `Email ${e.status}: ${e.recipient_email}`,
      detail: e.subject,
      timestamp: e.created_at,
    })),
    ...(automationRuns ?? []).slice(0, 5).map((r) => ({
      id: `run-${r.id}`,
      type: "automation",
      title: `Automation (${r.trigger_type}) — ${r.status}`,
      detail: `${r.jobs_discovered} jobs scanned, ${r.drafts_generated} drafts queued`,
      timestamp: r.started_at,
    })),
  ]
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    .slice(0, 15);

  return NextResponse.json({
    kpis,
    weeklySeries,
    monthlySeries,
    outcomes,
    scoreBuckets,
    activity,
  });
}
