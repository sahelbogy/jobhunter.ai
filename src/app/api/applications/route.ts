import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { generateCoverLetterPdfBuffer } from "@/lib/documents/cover-letter-pdf";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { validateRecipientEmail } from "@/lib/security/sanitize";

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? "").replace(/"/g, '""');
  return `"${s}"`;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { searchParams } = new URL(request.url);
  const approvalStatus = searchParams.get("approvalStatus") ?? "all";
  const trackingStatus = searchParams.get("trackingStatus") ?? "all";
  const format = searchParams.get("format");

  let query = supabase
    .from("applications")
    .select(
      `
      *,
      documents:application_documents (*)
    `
    )
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (approvalStatus !== "all") {
    query = query.eq("approval_status", approvalStatus);
  }
  if (trackingStatus !== "all") {
    query = query.eq("tracking_status", trackingStatus);
  }

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const applications = rows ?? [];

  if (format === "csv") {
    const header = [
      "Company",
      "Job Title",
      "Location",
      "Match Score (%)",
      "Approval Status",
      "Tracking Status",
      "Language",
      "Recipient Email",
      "Email Delivery Result",
      "Application Date",
      "Follow-up Date",
      "Job URL",
      "Notes",
    ];
    const csvRows = [
      header.map(escapeCsvCell).join(","),
      ...applications.map((a: any) =>
        [
          a.company_name,
          a.job_title,
          a.location,
          a.match_score ?? "",
          a.approval_status,
          a.tracking_status,
          a.language,
          a.recipient_email ?? "",
          a.email_delivery_result ?? "",
          a.applied_at ?? a.created_at,
          a.follow_up_date ?? "",
          a.job_url,
          a.notes ?? "",
        ]
          .map(escapeCsvCell)
          .join(",")
      ),
    ];

    return new NextResponse(csvRows.join("\r\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ai-job-hunter-applications-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ applications });
}

const ManualDraftSchema = z.object({
  job_id: z.string().uuid().optional().nullable(),
  resume_id: z.string().uuid().optional().nullable(),
  company_name: z.string().min(1).max(160),
  job_title: z.string().min(1).max(160),
  location: z.string().max(140).optional().default(""),
  job_url: z.string().max(500).optional().nullable().default(""),
  application_source: z.string().max(60).optional().default("manual"),
  match_score: z.number().min(0).max(100).optional().nullable(),
  language: z.enum(["fr", "en"]).default("en"),
  recipient_email: z.string().max(254).optional().nullable(),
  email_subject: z.string().max(300).optional().default(""),
  email_body: z.string().max(15000).optional().default(""),
  cover_letter_text: z.string().max(20000).optional().default(""),
  tracking_status: z
    .enum([
      "draft",
      "pending_approval",
      "sent",
      "applied_externally",
      "interview",
      "offer",
      "rejected",
      "withdrawn",
    ])
    .optional(),
  notes: z.string().max(4000).optional().default(""),
  queue_for_approval: z.boolean().optional().default(true),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    const body = ManualDraftSchema.parse(await request.json());

    let cleanRecipient: string | null = null;
    if (body.recipient_email?.trim()) {
      const check = validateRecipientEmail(body.recipient_email);
      if (!check.valid) {
        return NextResponse.json(
          { error: `Invalid recipient email: ${check.reason}` },
          { status: 400 }
        );
      }
      cleanRecipient = check.normalized;
    }

    const [{ data: profile }, { data: activeResume }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      body.resume_id
        ? supabase
            .from("resumes")
            .select("*")
            .eq("id", body.resume_id)
            .eq("user_id", user.id)
            .maybeSingle()
        : supabase
            .from("resumes")
            .select("*")
            .eq("user_id", user.id)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle(),
    ]);

    const insertPayload = {
      user_id: user.id,
      job_id: body.job_id ?? null,
      resume_id: activeResume?.id ?? null,
      company_name: body.company_name,
      job_title: body.job_title,
      location: body.location,
      job_url: body.job_url ?? "",
      application_source: body.application_source,
      match_score: body.match_score ?? null,
      language: body.language,
      recipient_email: cleanRecipient,
      recipient_source: cleanRecipient ? "user_verified_manual" : "none",
      email_subject:
        body.email_subject || `Application — ${body.job_title} at ${body.company_name}`,
      email_body: body.email_body || "",
      cover_letter_text: body.cover_letter_text || "",
      approval_status: body.queue_for_approval ? "awaiting_approval" : "draft",
      tracking_status:
        body.tracking_status ??
        (body.queue_for_approval ? "pending_approval" : "draft"),
      applied_at:
        body.tracking_status === "applied_externally"
          ? new Date().toISOString()
          : null,
      notes: body.notes ?? "",
      approval_hash: null,
      approved_at: null,
    };

    const { data: app, error: appErr } = body.job_id
      ? await supabase
          .from("applications")
          .upsert(insertPayload, { onConflict: "user_id,job_id" })
          .select("*")
          .single()
      : await supabase
          .from("applications")
          .insert(insertPayload)
          .select("*")
          .single();

    if (appErr || !app) {
      return NextResponse.json(
        { error: appErr?.message ?? "Could not save application draft." },
        { status: 400 }
      );
    }

    if (body.cover_letter_text && body.cover_letter_text.trim().length >= 10) {
      const admin = createAdminSupabaseClient();
      const pdfOut = await generateCoverLetterPdfBuffer({
        language: body.language,
        applicantName: profile?.full_name || user.email || "Candidate",
        applicantTitle: profile?.professional_title,
        applicantEmail: profile?.email || user.email,
        applicantPhone: profile?.phone,
        applicantLocation: profile?.location,
        companyName: body.company_name,
        companyLocation: body.location,
        jobTitle: body.job_title,
        subjectLine:
          body.email_subject || `Application — ${body.job_title}`,
        bodyText: body.cover_letter_text,
      });

      const clPath = `${user.id}/${app.id}/cover-letter.pdf`;
      await admin.storage
        .from("application-documents")
        .upload(clPath, pdfOut.buffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      await supabase.from("application_documents").upsert(
        {
          user_id: user.id,
          application_id: app.id,
          document_type: "cover_letter",
          file_name: `Cover_Letter_${body.company_name.replace(/[^a-zA-Z0-9]+/g, "_")}.pdf`,
          storage_bucket: "application-documents",
          storage_path: clPath,
          mime_type: "application/pdf",
          file_size: pdfOut.byteLength,
          content_sha256: pdfOut.sha256,
        },
        { onConflict: "application_id,document_type" }
      );
    }

    if (activeResume) {
      await supabase.from("application_documents").upsert(
        {
          user_id: user.id,
          application_id: app.id,
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

    const { data: hydrated } = await supabase
      .from("applications")
      .select("*, documents:application_documents(*)")
      .eq("id", app.id)
      .single();

    return NextResponse.json({ application: hydrated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid application data." },
      { status: 400 }
    );
  }
}
