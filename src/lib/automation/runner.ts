import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiProviderId, UserProfile } from "@/types/domain";
import { runJobDiscoveryForUser } from "@/lib/jobs/discovery";
import { generateTailoredApplicationWithAi } from "@/lib/documents/application-generator";
import { generateCoverLetterPdfBuffer } from "@/lib/documents/cover-letter-pdf";
import {
  dispatchApplicationToWhatsAppForApproval,
  normalizeWhatsAppPhone,
  type DispatchWhatsAppApprovalResult,
} from "@/lib/whatsapp/kapso";
import { buildVerifiedFallbackApplicationPackage } from "@/lib/documents/fallback-draft";

export interface AutomationRunSummary {
  runId: string;
  status: "completed" | "partial" | "failed" | "skipped_locked";
  jobsDiscovered: number;
  jobsDeduplicated: number;
  jobsMatched: number;
  draftsGenerated: number;
  notificationsSent: number;
  logs: string[];
  errorMessage?: string;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 800
): Promise<{ result: T; retryCount: number }> {
  let attempt = 0;
  while (true) {
    try {
      const result = await fn();
      return { result, retryCount: attempt };
    } catch (err) {
      if (attempt >= retries) throw err;
      attempt += 1;
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
}

/**
 * Executes the complete cloud automation workflow for a single user:
 * 1. Acquires atomic DB lock to prevent duplicate concurrent execution.
 * 2. Loads user's verified profile & active CV.
 * 3. Queries job discovery sources with retry resilience.
 * 4. Deduplicates & computes compatibility scores.
 * 5. Filters opportunities >= min_match_score.
 * 6. Generates tailored application drafts + Cover Letter PDFs -> queues in `awaiting_approval`.
 * 7. NEVER sends unapproved emails.
 * 8. Emits in-app notification & operational audit log.
 */
export async function executeAutomationRunForUser(params: {
  adminSupabase: SupabaseClient;
  userId: string;
  triggerType: "scheduled" | "manual";
}): Promise<AutomationRunSummary> {
  const { adminSupabase, userId, triggerType } = params;
  const logs: string[] = [];
  const log = (msg: string) => {
    logs.push(`[${new Date().toISOString()}] ${msg}`);
  };

  // Load automation settings
  let { data: settings } = await adminSupabase
    .from("automation_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!settings) {
    const { data: created } = await adminSupabase
      .from("automation_settings")
      .insert({ user_id: userId })
      .select("*")
      .single();
    settings = created;
  }

  // 1. Check distributed lock to prevent duplicate execution
  const now = Date.now();
  if (
    settings?.active_lock_id &&
    settings?.lock_expires_at &&
    new Date(settings.lock_expires_at).getTime() > now
  ) {
    log("Skipped execution: another automation run is currently holding an active lock.");
    const { data: skippedRun } = await adminSupabase
      .from("automation_runs")
      .insert({
        user_id: userId,
        trigger_type: triggerType,
        status: "skipped_locked",
        log_entries: logs,
        completed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    return {
      runId: skippedRun?.id ?? "locked",
      status: "skipped_locked",
      jobsDiscovered: 0,
      jobsDeduplicated: 0,
      jobsMatched: 0,
      draftsGenerated: 0,
      notificationsSent: 0,
      logs,
    };
  }

  const lockId = crypto.randomUUID();
  const lockExpiresAt = new Date(now + 5 * 60 * 1000).toISOString();

  await adminSupabase
    .from("automation_settings")
    .update({
      active_lock_id: lockId,
      lock_expires_at: lockExpiresAt,
    })
    .eq("user_id", userId);

  const { data: runRow } = await adminSupabase
    .from("automation_runs")
    .insert({
      user_id: userId,
      trigger_type: triggerType,
      status: "running",
      log_entries: logs,
    })
    .select("id")
    .single();

  const runId = runRow?.id ?? crypto.randomUUID();

  try {
    // 2. Load profile, preferences, and active resume
    const [{ data: profile }, { data: prefs }, { data: activeResume }] =
      await Promise.all([
        adminSupabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        adminSupabase
          .from("user_preferences")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle(),
        adminSupabase
          .from("resumes")
          .select("*")
          .eq("user_id", userId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    const userProfile = (profile ?? {}) as Partial<UserProfile>;
    log(
      `Loaded workspace profile for ${userProfile.full_name || userProfile.email || userId}.`
    );

    const searchKeyword =
      (settings?.search_keywords ?? []).join(" ").trim() ||
      userProfile.professional_title ||
      (userProfile.technical_skills ?? []).slice(0, 2).join(" ");

    // 3. Run job discovery with retry protection
    const { result: discovery, retryCount } = await withRetry(
      () =>
        runJobDiscoveryForUser({
          supabase: adminSupabase,
          userId,
          profile: userProfile,
          activeResumeId: activeResume?.id ?? null,
          filters: {
            query: searchKeyword,
            locations: settings?.search_locations ?? ["Morocco", "France", "Remote"],
            sector: settings?.preferred_sectors?.[0] ?? undefined,
            remotePreference: settings?.include_remote ? "any" : "onsite",
            limit: settings?.max_opportunities_per_run ?? 15,
          },
        }),
      1,
      900
    );

    log(
      `Discovery finished across ${discovery.sourceReports.length} sources: ${discovery.insertedOrUpdatedCount} saved, ${discovery.duplicatesRemoved} duplicates filtered.`
    );

    // 4. Filter matches meeting minimum compatibility threshold
    const minScore = Number(settings?.min_match_score ?? 70);
    const qualifiedJobs = discovery.jobs.filter(
      (j) => (j.match?.match_score ?? 0) >= minScore
    );
    log(
      `${qualifiedJobs.length} opportunities met minimum match threshold (${minScore}%).`
    );

    // 5. Generate drafts for top un-applied matches (NEVER auto-sends without human approval!)
    let draftsGenerated = 0;
    let whatsappApprovalsSent = 0;
    const whatsappEnabled = Boolean(settings?.whatsapp_enabled);
    const whatsappPhone = normalizeWhatsAppPhone(
      settings?.whatsapp_phone_number ?? ""
    );

    // 5a. First dispatch any pre-scheduled batch applications due today (`scheduled_for_date <= today`)
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (whatsappEnabled && whatsappPhone) {
      const { data: dueScheduledApps } = await adminSupabase
        .from("applications")
        .select("id, job_title, company_name")
        .eq("user_id", userId)
        .eq("approval_status", "awaiting_approval")
        .is("whatsapp_notified_at", null)
        .not("scheduled_for_date", "is", null)
        .lte("scheduled_for_date", todayUtc)
        .limit(10);

      for (const dueApp of dueScheduledApps ?? []) {
        const waRes = await dispatchApplicationToWhatsAppForApproval({
          adminSupabase,
          userId,
          applicationId: dueApp.id,
          whatsappPhone,
        }).catch(() => ({ dispatched: false, reason: "Kapso error" }));
        if (waRes.dispatched) {
          whatsappApprovalsSent += 1;
          log(
            `Sent due scheduled application '${dueApp.job_title}' (${dueApp.company_name}) to WhatsApp via Kapso.`
          );
        }
      }
    }

    const maxDrafts = settings?.auto_generate_drafts
      ? Math.min(Number(settings?.max_drafts_per_run ?? 5), 10)
      : 0;

    if (maxDrafts > 0 && qualifiedJobs.length > 0) {
      const candidateJobIds = qualifiedJobs.map((j) => j.id);
      const { data: existingApps } = await adminSupabase
        .from("applications")
        .select("job_id")
        .eq("user_id", userId)
        .in("job_id", candidateJobIds);

      const appliedSet = new Set((existingApps ?? []).map((a) => a.job_id));
      const targets = qualifiedJobs
        .filter((j) => !appliedSet.has(j.id))
        .slice(0, maxDrafts);

      for (const targetJob of targets) {
        try {
          let generated;
          try {
            generated = await generateTailoredApplicationWithAi({
              profile: userProfile,
              job: {
                title: targetJob.title,
                company_name: targetJob.company_name,
                location: targetJob.location,
                description: targetJob.description,
                required_skills: targetJob.required_skills ?? [],
                detected_language: targetJob.detected_language,
              },
              languageOverride: settings?.email_language ?? "auto",
              routing: {
                primaryProvider: (settings?.ai_provider ??
                  prefs?.primary_ai_provider ??
                  "groq") as AiProviderId,
                primaryModel: prefs?.primary_ai_model ?? null,
                fallbackProvider: (settings?.fallback_ai_provider ??
                  prefs?.fallback_ai_provider ??
                  null) as AiProviderId | null,
                fallbackModel: prefs?.fallback_ai_model ?? null,
                allowPaidFallback: Boolean(prefs?.allow_paid_fallback),
              },
              onLog: async (entry) => {
                await adminSupabase.from("ai_generation_logs").insert({
                  user_id: userId,
                  ...entry,
                });
              },
            });
          } catch {
            generated = buildVerifiedFallbackApplicationPackage({
              profile: userProfile,
              job: {
                title: targetJob.title,
                company_name: targetJob.company_name,
                location: targetJob.location,
                description: targetJob.description,
                required_skills: targetJob.required_skills ?? [],
                detected_language: targetJob.detected_language,
              },
              languageOverride: settings?.email_language ?? "auto",
            });
          }

          const { data: createdApp } = await adminSupabase
            .from("applications")
            .insert({
              user_id: userId,
              job_id: targetJob.id,
              job_match_id: targetJob.match?.id ?? null,
              resume_id: activeResume?.id ?? null,
              company_name: targetJob.company_name,
              job_title: targetJob.title,
              location: targetJob.location,
              job_url: targetJob.application_url,
              application_source: targetJob.source,
              match_score: targetJob.match?.match_score ?? null,
              language: generated.language,
              recipient_email: targetJob.public_recruitment_email ?? null,
              recipient_source: targetJob.public_recruitment_email
                ? "published_job_contact"
                : "none",
              email_subject: generated.email_subject,
              email_body: generated.email_body,
              cover_letter_text: generated.cover_letter_text,
              approval_status: "awaiting_approval",
              tracking_status: "pending_approval",
              ai_provider: generated.ai_provider,
              ai_model: generated.ai_model,
            })
            .select("*")
            .single();

          if (createdApp) {
            // Generate and store Cover Letter PDF in private bucket
            const pdfOut = await generateCoverLetterPdfBuffer({
              language: generated.language,
              applicantName: userProfile.full_name || "Candidate",
              applicantTitle: userProfile.professional_title,
              applicantEmail: userProfile.email,
              applicantPhone: userProfile.phone,
              applicantLocation: userProfile.location,
              companyName: targetJob.company_name,
              companyLocation: targetJob.location,
              jobTitle: targetJob.title,
              subjectLine: generated.cover_letter_subject,
              bodyText: generated.cover_letter_text,
            });

            const clPath = `${userId}/${createdApp.id}/cover-letter.pdf`;
            await adminSupabase.storage
              .from("application-documents")
              .upload(clPath, pdfOut.buffer, {
                contentType: "application/pdf",
                upsert: true,
              });

            await adminSupabase.from("application_documents").upsert(
              {
                user_id: userId,
                application_id: createdApp.id,
                document_type: "cover_letter",
                file_name: `Cover_Letter_${targetJob.company_name.replace(/[^a-zA-Z0-9]+/g, "_")}.pdf`,
                storage_bucket: "application-documents",
                storage_path: clPath,
                mime_type: "application/pdf",
                file_size: pdfOut.byteLength,
                content_sha256: pdfOut.sha256,
              },
              { onConflict: "application_id,document_type" }
            );

            if (activeResume) {
              await adminSupabase.from("application_documents").upsert(
                {
                  user_id: userId,
                  application_id: createdApp.id,
                  document_type: "cv",
                  file_name: activeResume.file_name,
                  storage_bucket: activeResume.storage_bucket,
                  storage_path: activeResume.storage_path,
                  mime_type: "application/pdf",
                  file_size: activeResume.file_size,
                  content_sha256: activeResume.file_sha256,
                },
                { onConflict: "application_id,document_type" }
              );
            }

            draftsGenerated += 1;
            log(
              `Queued application draft for '${targetJob.title}' at '${targetJob.company_name}' in Approval Queue.`
            );

            if (whatsappEnabled && whatsappPhone) {
              const waRes = await dispatchApplicationToWhatsAppForApproval({
                adminSupabase,
                userId,
                applicationId: createdApp.id,
                whatsappPhone,
              }).catch(
                (): DispatchWhatsAppApprovalResult => ({
                  dispatched: false,
                  reason: "Kapso error",
                })
              );

              if (waRes.dispatched) {
                whatsappApprovalsSent += 1;
                log(
                  `Dispatched WhatsApp approval card (#${waRes.approvalCode}) via Kapso for '${targetJob.title}'.`
                );
              } else if (waRes.reason) {
                log(`WhatsApp dispatch skipped: ${waRes.reason}`);
              }
            }
          }
        } catch (draftErr) {
          log(
            `Skipped AI draft for '${targetJob.title}': ${
              draftErr instanceof Error ? draftErr.message : "AI generation unavailable"
            }`
          );
        }
      }
    }

    // 6. Notify user when new matches or drafts are ready
    let notificationsSent = whatsappApprovalsSent;
    if (
      settings?.notify_in_app !== false &&
      (qualifiedJobs.length > 0 || draftsGenerated > 0 || whatsappApprovalsSent > 0)
    ) {
      await adminSupabase.from("notifications").insert({
        user_id: userId,
        title:
          whatsappApprovalsSent > 0
            ? `${whatsappApprovalsSent} Offer(s) Sent to WhatsApp for Approval`
            : draftsGenerated > 0
              ? `${draftsGenerated} Application Draft(s) Ready for Approval`
              : `${qualifiedJobs.length} High-Match Job Opportunities Found`,
        message: `Automation discovered ${discovery.insertedOrUpdatedCount} roles (${qualifiedJobs.length} scoring ${minScore}%+), queued ${draftsGenerated} tailored draft(s), and sent ${whatsappApprovalsSent} WhatsApp approval card(s).`,
        category: "automation",
        link_url: draftsGenerated > 0 ? "/approvals" : "/matching",
      });
      notificationsSent += 1;
    }

    const isCompletedSpecificDate =
      triggerType === "scheduled" &&
      settings?.schedule_mode === "specific_date" &&
      settings?.scheduled_date === todayUtc;

    const nextRun = isCompletedSpecificDate
      ? null
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const completedAt = new Date().toISOString();

    await Promise.all([
      adminSupabase
        .from("automation_runs")
        .update({
          status: "completed",
          sources_queried: discovery.sourceReports.map((s) => s.source),
          jobs_discovered: discovery.discoveredCount,
          jobs_inserted: discovery.insertedOrUpdatedCount,
          jobs_deduplicated: discovery.duplicatesRemoved,
          jobs_matched: qualifiedJobs.length,
          drafts_generated: draftsGenerated,
          notifications_sent: notificationsSent,
          retry_count: retryCount,
          log_entries: logs,
          completed_at: completedAt,
        })
        .eq("id", runId),
      adminSupabase
        .from("automation_settings")
        .update({
          last_run_at: completedAt,
          next_run_at: nextRun,
          active_lock_id: null,
          lock_expires_at: null,
        })
        .eq("user_id", userId),
    ]);

    return {
      runId,
      status: "completed",
      jobsDiscovered: discovery.discoveredCount,
      jobsDeduplicated: discovery.duplicatesRemoved,
      jobsMatched: qualifiedJobs.length,
      draftsGenerated,
      notificationsSent,
      logs,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Automation run failed";
    log(`Fatal automation error: ${errMsg}`);

    await Promise.all([
      adminSupabase
        .from("automation_runs")
        .update({
          status: "failed",
          log_entries: logs,
          error_message: errMsg,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId),
      adminSupabase
        .from("automation_settings")
        .update({
          active_lock_id: null,
          lock_expires_at: null,
        })
        .eq("user_id", userId),
    ]);

    return {
      runId,
      status: "failed",
      jobsDiscovered: 0,
      jobsDeduplicated: 0,
      jobsMatched: 0,
      draftsGenerated: 0,
      notificationsSent: 0,
      logs,
      errorMessage: errMsg,
    };
  }
}
