import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiProviderId, SupportedLanguage, UserProfile } from "@/types/domain";
import { generateTailoredApplicationWithAi } from "@/lib/documents/application-generator";
import { buildVerifiedFallbackApplicationPackage } from "@/lib/documents/fallback-draft";
import { generateCoverLetterPdfBuffer } from "@/lib/documents/cover-letter-pdf";
import { dispatchApplicationToWhatsAppForApproval } from "@/lib/whatsapp/kapso";

export interface PreparedApplicationSummary {
  applicationId: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  language: SupportedLanguage;
  aiProvider: string;
  recipientEmail: string | null;
  scheduledForDate: string | null;
  whatsappDispatched: boolean;
  whatsappApprovalCode?: string;
  whatsappNote?: string;
}

export async function prepareSingleJobApplicationForUser(params: {
  adminSupabase: SupabaseClient;
  userId: string;
  profile: Partial<UserProfile>;
  activeResume: {
    id: string;
    file_name: string;
    storage_bucket: string;
    storage_path: string;
    file_size: number;
    file_sha256: string;
  } | null;
  job: Record<string, any>;
  matchId?: string | null;
  matchScore?: number | null;
  primaryProvider: AiProviderId;
  fallbackProvider: AiProviderId | null;
  languageOverride?: "auto" | SupportedLanguage;
  scheduledForDate?: string | null;
  dispatchWhatsAppNow?: boolean;
  whatsappPhone?: string | null;
}): Promise<PreparedApplicationSummary> {
  const {
    adminSupabase,
    userId,
    profile,
    activeResume,
    job,
    primaryProvider,
    fallbackProvider,
  } = params;

  let generated;
  try {
    generated = await generateTailoredApplicationWithAi({
      profile,
      job: {
        title: job.title,
        company_name: job.company_name,
        location: job.location,
        description: job.description || "",
        required_skills: job.required_skills ?? [],
        detected_language: job.detected_language,
      },
      languageOverride: params.languageOverride ?? "auto",
      routing: {
        primaryProvider,
        fallbackProvider,
        userId,
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
      profile,
      job: {
        title: job.title,
        company_name: job.company_name,
        location: job.location,
        description: job.description || "",
        required_skills: job.required_skills ?? [],
        detected_language: job.detected_language,
      },
      languageOverride: params.languageOverride ?? "auto",
    });
  }

  // Upsert application (respects unique(user_id, job_id) while never overwriting an already-sent application)
  const { data: existingApp } = await adminSupabase
    .from("applications")
    .select("id, approval_status")
    .eq("user_id", userId)
    .eq("job_id", job.id)
    .maybeSingle();

  if (existingApp && existingApp.approval_status === "sent") {
    throw new Error(
      `Application for '${job.title}' at '${job.company_name}' has already been sent.`
    );
  }

  const appPayload = {
    user_id: userId,
    job_id: job.id,
    job_match_id: params.matchId ?? job.match?.id ?? null,
    resume_id: activeResume?.id ?? null,
    company_name: job.company_name,
    job_title: job.title,
    location: job.location || "",
    job_url: job.application_url || "",
    application_source: job.source || "direct",
    match_score: params.matchScore ?? job.match?.match_score ?? null,
    language: generated.language,
    recipient_email: job.public_recruitment_email ?? null,
    recipient_source: job.public_recruitment_email
      ? "published_job_contact"
      : "none",
    email_subject: generated.email_subject,
    email_body: generated.email_body,
    cover_letter_text: generated.cover_letter_text,
    approval_status: "awaiting_approval",
    tracking_status: "pending_approval",
    approval_hash: null,
    approved_at: null,
    scheduled_for_date: params.scheduledForDate ?? null,
    ai_provider: generated.ai_provider,
    ai_model: generated.ai_model,
  };

  const { data: savedApp, error: appErr } = existingApp
    ? await adminSupabase
        .from("applications")
        .update(appPayload)
        .eq("id", existingApp.id)
        .select("*")
        .single()
    : await adminSupabase
        .from("applications")
        .insert(appPayload)
        .select("*")
        .single();

  if (appErr || !savedApp) {
    throw new Error(appErr?.message || "Failed to persist prepared application.");
  }

  // Build and upload Cover Letter PDF
  const pdfOut = await generateCoverLetterPdfBuffer({
    language: generated.language,
    applicantName: profile.full_name || "Candidate",
    applicantTitle: profile.professional_title,
    applicantEmail: profile.email,
    applicantPhone: profile.phone,
    applicantLocation: profile.location,
    companyName: job.company_name,
    companyLocation: job.location,
    jobTitle: job.title,
    subjectLine: generated.cover_letter_subject,
    bodyText: generated.cover_letter_text,
  });

  const clPath = `${userId}/${savedApp.id}/cover-letter.pdf`;
  const { error: uploadErr } = await adminSupabase.storage
    .from("application-documents")
    .upload(clPath, pdfOut.buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadErr) {
    throw new Error(`Cover Letter PDF storage upload failed: ${uploadErr.message}`);
  }

  await adminSupabase.from("application_documents").upsert(
    {
      user_id: userId,
      application_id: savedApp.id,
      document_type: "cover_letter",
      file_name: `Cover_Letter_${String(job.company_name || "Company").replace(
        /[^a-zA-Z0-9]+/g,
        "_"
      )}.pdf`,
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
        application_id: savedApp.id,
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

  let whatsappDispatched = false;
  let whatsappApprovalCode: string | undefined;
  let whatsappNote: string | undefined;

  if (params.dispatchWhatsAppNow && params.whatsappPhone) {
    try {
      const wa = await dispatchApplicationToWhatsAppForApproval({
        adminSupabase,
        userId,
        applicationId: savedApp.id,
        whatsappPhone: params.whatsappPhone,
      });
      whatsappDispatched = wa.dispatched;
      whatsappApprovalCode = wa.approvalCode;
      whatsappNote = wa.reason;
    } catch (waErr) {
      whatsappDispatched = false;
      whatsappNote =
        waErr instanceof Error
          ? waErr.message
          : "WhatsApp dispatch encountered an error.";
    }
  }

  return {
    applicationId: savedApp.id,
    jobId: job.id,
    jobTitle: job.title,
    companyName: job.company_name,
    language: generated.language,
    aiProvider: generated.ai_provider,
    recipientEmail: savedApp.recipient_email ?? null,
    scheduledForDate: savedApp.scheduled_for_date ?? null,
    whatsappDispatched,
    whatsappApprovalCode,
    whatsappNote,
  };
}
