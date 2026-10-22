import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { generateTailoredApplicationWithAi } from "@/lib/documents/application-generator";
import { buildVerifiedFallbackApplicationPackage } from "@/lib/documents/fallback-draft";
import { generateCoverLetterPdfBuffer } from "@/lib/documents/cover-letter-pdf";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { AiProviderError } from "@/lib/ai/types";
import type { AiProviderId, UserProfile } from "@/types/domain";

const GenerateBodySchema = z.object({
  jobId: z.string().uuid(),
  resumeId: z.string().uuid().optional().nullable(),
  languageOverride: z.enum(["auto", "fr", "en"]).optional().default("auto"),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const rl = checkRateLimit(`ai_generate:${user.id}`, 15, 5 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `AI generation rate limit reached. Retry in ${rl.retryAfterSeconds}s.`,
      },
      { status: 429 }
    );
  }

  try {
    const body = GenerateBodySchema.parse(await request.json());

    const [{ data: job }, { data: profile }, { data: prefs }, { data: resume }] =
      await Promise.all([
        supabase
          .from("jobs")
          .select("*, job_matches(*)")
          .eq("id", body.jobId)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase
          .from("user_preferences")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle(),
        body.resumeId
          ? supabase
              .from("resumes")
              .select("*")
              .eq("id", body.resumeId)
              .eq("user_id", user.id)
              .maybeSingle()
          : supabase
              .from("resumes")
              .select("*")
              .eq("user_id", user.id)
              .eq("is_active", true)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
      ]);

    if (!job) {
      return NextResponse.json(
        { error: "Selected job was not found in your workspace." },
        { status: 404 }
      );
    }

    const admin = createAdminSupabaseClient();
    const userProfile = (profile ?? {}) as Partial<UserProfile>;

    let generated;
    let aiWarning: string | null = null;

    try {
      generated = await generateTailoredApplicationWithAi({
        profile: userProfile,
        job: {
          title: job.title,
          company_name: job.company_name,
          location: job.location,
          description: job.description,
          required_skills: job.required_skills ?? [],
          detected_language: job.detected_language,
        },
        languageOverride: body.languageOverride,
        routing: {
          primaryProvider: (prefs?.primary_ai_provider ?? "groq") as AiProviderId,
          primaryModel: prefs?.primary_ai_model ?? null,
          fallbackProvider: (prefs?.fallback_ai_provider ??
            null) as AiProviderId | null,
          fallbackModel: prefs?.fallback_ai_model ?? null,
          allowPaidFallback: Boolean(prefs?.allow_paid_fallback),
          userId: user.id,
        },
        onLog: async (entry) => {
          await admin.from("ai_generation_logs").insert({
            user_id: user.id,
            ...entry,
          });
        },
      });
    } catch (genErr) {
      if (
        genErr instanceof AiProviderError &&
        genErr.code === "MISSING_CREDENTIALS"
      ) {
        generated = buildVerifiedFallbackApplicationPackage({
          profile: userProfile,
          job: {
            title: job.title,
            company_name: job.company_name,
            location: job.location,
            description: job.description,
            required_skills: job.required_skills ?? [],
            detected_language: job.detected_language,
          },
          languageOverride: body.languageOverride,
        });
        aiWarning =
          "No AI API key configured yet — generated factual baseline draft from your verified CV. Add a free Groq key in Account Settings -> AI Providers to unlock full LLM tailoring.";
      } else {
        throw genErr;
      }
    }

    const matchRecord = Array.isArray(job.job_matches)
      ? job.job_matches[0]
      : job.job_matches;

    // Check if an application already exists for this job (unless already sent!)
    const { data: existingApp } = await supabase
      .from("applications")
      .select("id, approval_status, recipient_email, recipient_source")
      .eq("user_id", user.id)
      .eq("job_id", job.id)
      .maybeSingle();

    if (existingApp?.approval_status === "sent") {
      return NextResponse.json(
        {
          error:
            "An approved application has already been sent for this job opportunity.",
        },
        { status: 409 }
      );
    }

    const recipientEmail =
      existingApp?.recipient_email || job.public_recruitment_email || null;
    const recipientSource = existingApp?.recipient_email
      ? existingApp.recipient_source
      : job.public_recruitment_email
        ? "published_job_contact"
        : "none";

    // Regenerating ALWAYS resets approval_status to awaiting_approval and clears approval_hash
    const { data: savedApp, error: saveErr } = await supabase
      .from("applications")
      .upsert(
        {
          user_id: user.id,
          job_id: job.id,
          job_match_id: matchRecord?.id ?? null,
          resume_id: resume?.id ?? null,
          company_name: job.company_name,
          job_title: job.title,
          location: job.location,
          job_url: job.application_url,
          application_source: job.source,
          match_score: matchRecord?.match_score ?? null,
          language: generated.language,
          recipient_email: recipientEmail,
          recipient_source: recipientSource,
          email_subject: generated.email_subject,
          email_body: generated.email_body,
          cover_letter_text: generated.cover_letter_text,
          approval_status: "awaiting_approval",
          tracking_status: "pending_approval",
          approval_hash: null,
          approved_at: null,
          approved_recipient: null,
          ai_provider: generated.ai_provider,
          ai_model: generated.ai_model,
        },
        { onConflict: "user_id,job_id" }
      )
      .select("*")
      .single();

    if (saveErr || !savedApp) {
      return NextResponse.json(
        { error: saveErr?.message ?? "Failed to persist generated application." },
        { status: 500 }
      );
    }

    // Generate formatted Cover Letter PDF and store in private bucket
    const pdfOut = await generateCoverLetterPdfBuffer({
      language: generated.language,
      applicantName: userProfile.full_name || user.email || "Candidate",
      applicantTitle: userProfile.professional_title,
      applicantEmail: userProfile.email || user.email,
      applicantPhone: userProfile.phone,
      applicantLocation: userProfile.location,
      companyName: job.company_name,
      companyLocation: job.location,
      jobTitle: job.title,
      subjectLine: generated.cover_letter_subject,
      bodyText: generated.cover_letter_text,
    });

    const clPath = `${user.id}/${savedApp.id}/cover-letter.pdf`;
    const { error: clUpErr } = await admin.storage
      .from("application-documents")
      .upload(clPath, pdfOut.buffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (clUpErr) {
      return NextResponse.json(
        { error: `Failed to store Cover Letter PDF: ${clUpErr.message}` },
        { status: 500 }
      );
    }

    await supabase.from("application_documents").upsert(
      {
        user_id: user.id,
        application_id: savedApp.id,
        document_type: "cover_letter",
        file_name: `Cover_Letter_${job.company_name.replace(/[^a-zA-Z0-9]+/g, "_")}.pdf`,
        storage_bucket: "application-documents",
        storage_path: clPath,
        mime_type: "application/pdf",
        file_size: pdfOut.byteLength,
        content_sha256: pdfOut.sha256,
      },
      { onConflict: "application_id,document_type" }
    );

    if (resume) {
      await supabase.from("application_documents").upsert(
        {
          user_id: user.id,
          application_id: savedApp.id,
          document_type: "cv",
          file_name: resume.file_name,
          storage_bucket: resume.storage_bucket,
          storage_path: resume.storage_path,
          mime_type: "application/pdf",
          file_size: resume.file_size,
          content_sha256: resume.file_sha256,
        },
        { onConflict: "application_id,document_type" }
      );
    }

    const { data: hydrated } = await supabase
      .from("applications")
      .select("*, documents:application_documents(*)")
      .eq("id", savedApp.id)
      .single();

    return NextResponse.json({
      application: hydrated,
      generated,
      aiWarning,
    });
  } catch (err) {
    if (err instanceof AiProviderError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          provider: err.provider,
          requiresConfiguration: err.code === "MISSING_CREDENTIALS",
        },
        { status: err.code === "RATE_LIMITED" ? 429 : 422 }
      );
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Application generation failed.",
      },
      { status: 500 }
    );
  }
}
