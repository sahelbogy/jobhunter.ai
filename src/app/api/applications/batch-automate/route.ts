import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { validateRecipientEmail } from "@/lib/security/sanitize";
import { prepareSingleJobApplicationForUser } from "@/lib/automation/prepare-application";
import type { AiProviderId } from "@/types/domain";

const BatchAutomateSchema = z.object({
  jobIds: z.array(z.string().uuid()).min(1).max(10),
  executionTiming: z.enum(["now", "daily", "specific_date"]),
  scheduledDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "scheduledDate must be YYYY-MM-DD")
    .optional()
    .nullable(),
  sendEmailApproval: z.boolean().default(true),
  approverEmail: z.string().max(180).optional(),
  languageOverride: z.enum(["auto", "fr", "en"]).default("auto"),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const rl = checkRateLimit(`batch-automate:${user.id}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before running another batch." },
      { status: 429 }
    );
  }

  try {
    const parsed = BatchAutomateSchema.parse(await request.json());
    const todayUtc = new Date().toISOString().slice(0, 10);

    if (parsed.executionTiming === "specific_date" && !parsed.scheduledDate) {
      return NextResponse.json(
        { error: "Please choose the exact date (YYYY-MM-DD) for 'specific_date' mode." },
        { status: 400 }
      );
    }

    const adminSupabase = createAdminSupabaseClient();

    const [
      { data: profile },
      { data: activeResume },
      { data: autoSettings },
      { data: emailConn },
      { data: jobs },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase
        .from("resumes")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("automation_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
      adminSupabase
        .from("email_connections")
        .select("email_address, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("jobs")
        .select(
          `
          *,
          job_matches (
            id,
            match_score
          )
        `
        )
        .eq("user_id", user.id)
        .in("id", parsed.jobIds),
    ]);

    if (!jobs || jobs.length === 0) {
      return NextResponse.json(
        { error: "No matching job offers found for the selected IDs." },
        { status: 404 }
      );
    }

    const rawApprover =
      parsed.approverEmail?.trim() ||
      autoSettings?.approval_email_recipient?.trim() ||
      emailConn?.email_address?.trim() ||
      profile?.email?.trim() ||
      user.email ||
      "";
    const approverCheck = validateRecipientEmail(rawApprover);
    const normalizedApprover = approverCheck.valid
      ? approverCheck.normalized
      : null;

    // Persist Email Approval & schedule preferences if requested
    if (
      parsed.executionTiming === "daily" ||
      parsed.executionTiming === "specific_date" ||
      (parsed.sendEmailApproval && normalizedApprover)
    ) {
      const settingsPatch: Record<string, unknown> = {
        user_id: user.id,
      };
      if (parsed.executionTiming === "daily") {
        settingsPatch.is_enabled = true;
        settingsPatch.schedule_mode = "daily";
        settingsPatch.max_drafts_per_run = Math.max(
          Number(autoSettings?.max_drafts_per_run ?? 3),
          jobs.length
        );
      } else if (parsed.executionTiming === "specific_date") {
        settingsPatch.is_enabled = true;
        settingsPatch.schedule_mode = "specific_date";
        settingsPatch.scheduled_date = parsed.scheduledDate;
      }
      if (parsed.sendEmailApproval && normalizedApprover) {
        settingsPatch.email_approval_enabled = true;
        settingsPatch.approval_email_recipient = normalizedApprover;
      }

      await supabase
        .from("automation_settings")
        .upsert(settingsPatch, { onConflict: "user_id" });
    }

    const primaryProvider = (autoSettings?.ai_provider ?? "groq") as AiProviderId;
    const fallbackProvider = (autoSettings?.fallback_ai_provider ??
      null) as AiProviderId | null;

    const isImmediate =
      parsed.executionTiming === "now" ||
      parsed.executionTiming === "daily" ||
      (parsed.executionTiming === "specific_date" &&
        parsed.scheduledDate &&
        parsed.scheduledDate <= todayUtc);

    const scheduledForDate =
      parsed.executionTiming === "specific_date" &&
      parsed.scheduledDate &&
      parsed.scheduledDate > todayUtc
        ? parsed.scheduledDate
        : null;

    const prepared = [];
    const errors: Array<{ jobId: string; title: string; error: string }> = [];

    for (const rawJob of jobs) {
      const matchObj = Array.isArray(rawJob.job_matches)
        ? rawJob.job_matches[0] ?? null
        : rawJob.job_matches ?? null;

      try {
        const summary = await prepareSingleJobApplicationForUser({
          adminSupabase,
          userId: user.id,
          profile: {
            ...(profile ?? {}),
            email: profile?.email || user.email || "",
          },
          activeResume: activeResume ?? null,
          job: { ...rawJob, match: matchObj },
          matchId: matchObj?.id ?? null,
          matchScore: matchObj?.match_score ?? null,
          primaryProvider,
          fallbackProvider,
          languageOverride: parsed.languageOverride,
          scheduledForDate,
          dispatchEmailApprovalNow: Boolean(
            isImmediate && parsed.sendEmailApproval && normalizedApprover
          ),
          approverEmail: normalizedApprover,
        });
        prepared.push(summary);
      } catch (err) {
        errors.push({
          jobId: rawJob.id,
          title: rawJob.title,
          error: err instanceof Error ? err.message : "Failed to prepare draft",
        });
      }
    }

    const emailApprovalSentCount = prepared.filter(
      (p) => p.emailApprovalDispatched
    ).length;

    await adminSupabase.from("notifications").insert({
      user_id: user.id,
      title: scheduledForDate
        ? `${prepared.length} Offer(s) Scheduled for ${scheduledForDate}`
        : `${prepared.length} Offer(s) Prepared${emailApprovalSentCount > 0 ? ` & Sent to Your Email` : ""}`,
      message: scheduledForDate
        ? `Tailored emails and Cover Letter PDFs were generated for ${prepared.length} selected offer(s) and scheduled for Email Approval on ${scheduledForDate}.`
        : `Generated ${prepared.length} tailored application(s)${
            emailApprovalSentCount > 0
              ? ` and sent ${emailApprovalSentCount} approval email(s) to ${normalizedApprover}.`
              : ` in your Approval Queue.`
          }`,
      category: "automation",
      link_url: "/approvals",
    });

    return NextResponse.json({
      ok: true,
      executionTiming: parsed.executionTiming,
      scheduledForDate,
      preparedCount: prepared.length,
      emailApprovalSentCount,
      prepared,
      errors,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Batch application automation failed.",
      },
      { status: 400 }
    );
  }
}
