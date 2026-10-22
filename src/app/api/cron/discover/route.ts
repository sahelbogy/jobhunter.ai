import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dispatchApplicationToEmailForApproval } from "@/lib/email/approval-loop";
import { executeAutomationRunForUser } from "@/lib/automation/runner";

/**
 * Vercel Cron endpoint (`0 7 * * *` UTC).
 * Supports:
 * 1) Daily recurring automation (`schedule_mode = 'daily'`)
 * 2) Specific-day automation (`schedule_mode = 'specific_date'` when `scheduled_date = today`)
 * 3) Pre-generated batch applications scheduled for today (`applications.scheduled_for_date <= today`)
 *
 * Protected by mandatory `CRON_SECRET` Bearer authorization header.
 * Never auto-sends applications to employers prior to explicit human email approval.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized cron invocation." },
      { status: 401 }
    );
  }

  try {
    const admin = createAdminSupabaseClient();
    const todayUtc = new Date().toISOString().slice(0, 10);

    const { data: enabledUsers, error } = await admin
      .from("automation_settings")
      .select(
        "user_id, schedule_mode, scheduled_date, email_approval_enabled, approval_email_recipient"
      )
      .eq("is_enabled", true)
      .limit(25);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const eligibleUserIds = new Set<string>();
    for (const row of enabledUsers ?? []) {
      const mode = row.schedule_mode || "daily";
      if (mode === "daily") {
        eligibleUserIds.add(row.user_id);
      } else if (mode === "specific_date" && row.scheduled_date === todayUtc) {
        eligibleUserIds.add(row.user_id);
      }
    }

    const summaries = [];
    for (const uid of eligibleUserIds) {
      const summary = await executeAutomationRunForUser({
        adminSupabase: admin,
        userId: uid,
        triggerType: "scheduled",
      });
      summaries.push({ userId: uid, ...summary });
    }

    // Also dispatch any pre-generated batch offers due today for users who didn't run full discovery
    const { data: remainingDueApps } = await admin
      .from("applications")
      .select("id, user_id")
      .eq("approval_status", "awaiting_approval")
      .is("approval_email_sent_at", null)
      .not("scheduled_for_date", "is", null)
      .lte("scheduled_for_date", todayUtc)
      .limit(30);

    let standaloneScheduledEmailsSent = 0;
    for (const due of remainingDueApps ?? []) {
      const { data: s } = await admin
        .from("automation_settings")
        .select("email_approval_enabled, approval_email_recipient")
        .eq("user_id", due.user_id)
        .maybeSingle();

      if (s?.email_approval_enabled !== false) {
        const res = await dispatchApplicationToEmailForApproval({
          adminSupabase: admin,
          userId: due.user_id,
          applicationId: due.id,
          approverEmail: s?.approval_email_recipient?.trim() || null,
        }).catch(() => ({ dispatched: false }));
        if (res.dispatched) standaloneScheduledEmailsSent += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      dateUtc: todayUtc,
      processedUsers: summaries.length,
      standaloneScheduledEmailsSent,
      summaries,
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
