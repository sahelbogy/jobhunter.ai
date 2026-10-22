import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { executeAutomationRunForUser } from "@/lib/automation/runner";

function verifyCronSecret(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || expected.length < 16) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) return false;
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function handleScheduledDiscovery(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { error: "Unauthorized scheduled cron invocation." },
      { status: 401 }
    );
  }

  try {
    const admin = createAdminSupabaseClient();
    // Process up to 10 opted-in workspaces per cron invocation to stay well inside
    // serverless execution budgets on Vercel Hobby/Pro plans.
    const { data: enabledSettings, error } = await admin
      .from("automation_settings")
      .select("user_id, last_run_at")
      .eq("is_enabled", true)
      .order("last_run_at", { ascending: true, nullsFirst: true })
      .limit(10);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results = [];
    for (const row of enabledSettings ?? []) {
      const summary = await executeAutomationRunForUser({
        adminSupabase: admin,
        userId: row.user_id,
        triggerType: "scheduled",
      });
      results.push({
        userId: row.user_id,
        runId: summary.runId,
        status: summary.status,
        jobsDiscovered: summary.jobsDiscovered,
        jobsMatched: summary.jobsMatched,
        draftsGenerated: summary.draftsGenerated,
      });
    }

    return NextResponse.json({
      executedAt: new Date().toISOString(),
      usersProcessed: results.length,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Scheduled automation execution failed.",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleScheduledDiscovery(request);
}

export async function POST(request: NextRequest) {
  return handleScheduledDiscovery(request);
}
