import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { validateRecipientEmail } from "@/lib/security/sanitize";
import { generateCoverLetterPdfBuffer } from "@/lib/documents/cover-letter-pdf";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const PatchApplicationSchema = z.object({
  recipient_email: z.string().max(254).nullable().optional(),
  email_subject: z.string().min(2).max(300).optional(),
  email_body: z.string().min(5).max(15000).optional(),
  cover_letter_text: z.string().min(10).max(20000).optional(),
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
  follow_up_date: z.string().nullable().optional(),
  notes: z.string().max(4000).optional(),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;
  const { id } = await context.params;

  const { data: app, error } = await supabase
    .from("applications")
    .select("*, documents:application_documents(*)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !app) {
    return NextResponse.json(
      { error: "Application not found." },
      { status: 404 }
    );
  }

  return NextResponse.json({ application: app });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;
  const { id } = await context.params;

  const { data: existing } = await supabase
    .from("applications")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: "Application not found." },
      { status: 404 }
    );
  }

  try {
    const body = PatchApplicationSchema.parse(await request.json());
    const updates: Record<string, any> = {};

    let contentOrRecipientMutated = false;

    if (body.recipient_email !== undefined) {
      if (existing.approval_status === "sent") {
        return NextResponse.json(
          { error: "Cannot change recipient on an already-sent application." },
          { status: 400 }
        );
      }
      if (body.recipient_email && body.recipient_email.trim()) {
        const check = validateRecipientEmail(body.recipient_email);
        if (!check.valid) {
          return NextResponse.json(
            { error: `Invalid recipient email: ${check.reason}` },
            { status: 400 }
          );
        }
        if (check.normalized !== existing.recipient_email) {
          contentOrRecipientMutated = true;
          updates.recipient_email = check.normalized;
          updates.recipient_source = "user_verified_manual";
        }
      } else if (existing.recipient_email !== null) {
        contentOrRecipientMutated = true;
        updates.recipient_email = null;
        updates.recipient_source = "none";
      }
    }

    if (
      body.email_subject !== undefined &&
      body.email_subject.trim() !== existing.email_subject
    ) {
      if (existing.approval_status === "sent") {
        return NextResponse.json(
          { error: "Cannot edit email content after sending." },
          { status: 400 }
        );
      }
      contentOrRecipientMutated = true;
      updates.email_subject = body.email_subject.trim();
    }

    if (
      body.email_body !== undefined &&
      body.email_body.trim() !== existing.email_body
    ) {
      if (existing.approval_status === "sent") {
        return NextResponse.json(
          { error: "Cannot edit email content after sending." },
          { status: 400 }
        );
      }
      contentOrRecipientMutated = true;
      updates.email_body = body.email_body.trim();
    }

    let coverLetterChanged = false;
    if (
      body.cover_letter_text !== undefined &&
      body.cover_letter_text.trim() !== existing.cover_letter_text
    ) {
      if (existing.approval_status === "sent") {
        return NextResponse.json(
          { error: "Cannot edit cover letter after sending." },
          { status: 400 }
        );
      }
      contentOrRecipientMutated = true;
      coverLetterChanged = true;
      updates.cover_letter_text = body.cover_letter_text.trim();
    }

    // MANDATORY SECURITY RULE:
    // If recipient, email subject, email body, or cover letter changed after approval,
    // invalidate approval immediately and require fresh manual approval!
    let approvalInvalidated = false;
    if (contentOrRecipientMutated) {
      if (existing.approval_status === "approved") {
        approvalInvalidated = true;
      }
      updates.approval_status = "awaiting_approval";
      updates.approval_hash = null;
      updates.approved_at = null;
      updates.approved_recipient = null;
    }

    if (body.tracking_status !== undefined) {
      updates.tracking_status = body.tracking_status;
      if (
        body.tracking_status === "applied_externally" &&
        !existing.applied_at
      ) {
        updates.applied_at = new Date().toISOString();
      }
    }
    if (body.follow_up_date !== undefined) {
      updates.follow_up_date = body.follow_up_date || null;
    }
    if (body.notes !== undefined) {
      updates.notes = body.notes;
    }

    const { error: upErr } = await supabase
      .from("applications")
      .update(updates)
      .eq("id", existing.id)
      .eq("user_id", user.id);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    // Regenerate Cover Letter PDF in private storage if cover letter text changed
    if (coverLetterChanged) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      const admin = createAdminSupabaseClient();
      const pdfOut = await generateCoverLetterPdfBuffer({
        language: existing.language,
        applicantName: profile?.full_name || user.email || "Candidate",
        applicantTitle: profile?.professional_title,
        applicantEmail: profile?.email || user.email,
        applicantPhone: profile?.phone,
        applicantLocation: profile?.location,
        companyName: existing.company_name,
        companyLocation: existing.location,
        jobTitle: existing.job_title,
        subjectLine: updates.email_subject ?? existing.email_subject,
        bodyText: updates.cover_letter_text,
      });

      const clPath = `${user.id}/${existing.id}/cover-letter.pdf`;
      await admin.storage
        .from("application-documents")
        .upload(clPath, pdfOut.buffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      await supabase.from("application_documents").upsert(
        {
          user_id: user.id,
          application_id: existing.id,
          document_type: "cover_letter",
          file_name: `Cover_Letter_${existing.company_name.replace(/[^a-zA-Z0-9]+/g, "_")}.pdf`,
          storage_bucket: "application-documents",
          storage_path: clPath,
          mime_type: "application/pdf",
          file_size: pdfOut.byteLength,
          content_sha256: pdfOut.sha256,
        },
        { onConflict: "application_id,document_type" }
      );
    }

    const { data: updated } = await supabase
      .from("applications")
      .select("*, documents:application_documents(*)")
      .eq("id", existing.id)
      .eq("user_id", user.id)
      .single();

    return NextResponse.json({
      application: updated,
      approvalInvalidated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid update payload." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;
  const { id } = await context.params;

  const { data: docs } = await supabase
    .from("application_documents")
    .select("storage_bucket, storage_path, document_type")
    .eq("application_id", id)
    .eq("user_id", user.id);

  const clPaths = (docs ?? [])
    .filter((d) => d.document_type === "cover_letter")
    .map((d) => d.storage_path);

  if (clPaths.length > 0) {
    const admin = createAdminSupabaseClient();
    await admin.storage
      .from("application-documents")
      .remove(clPaths)
      .catch(() => {});
  }

  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
