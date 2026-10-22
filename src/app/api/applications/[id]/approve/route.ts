import { NextResponse, type NextRequest } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { computeApprovalHash } from "@/lib/security/approval";
import { validateRecipientEmail } from "@/lib/security/sanitize";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;
  const { id } = await context.params;

  const { data: app } = await supabase
    .from("applications")
    .select("*, documents:application_documents(*)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!app) {
    return NextResponse.json(
      { error: "Application not found." },
      { status: 404 }
    );
  }

  if (app.approval_status === "sent") {
    return NextResponse.json(
      { error: "This application has already been sent." },
      { status: 400 }
    );
  }

  // Validate recipient email before allowing approval for email delivery
  const recipientCheck = validateRecipientEmail(app.recipient_email);
  if (!recipientCheck.valid) {
    return NextResponse.json(
      {
        error: `Cannot approve email delivery without a valid recruitment email (${recipientCheck.reason}). Either enter a verified recruitment email or use 'Apply Externally' via the official job URL.`,
      },
      { status: 400 }
    );
  }

  if (!app.email_subject?.trim() || !app.email_body?.trim()) {
    return NextResponse.json(
      { error: "Email subject and message body cannot be empty." },
      { status: 400 }
    );
  }

  // Ensure active CV is linked if not yet linked
  let docs: Array<any> = app.documents ?? [];
  let cvDoc = docs.find((d) => d.document_type === "cv");
  const coverLetterDoc = docs.find((d) => d.document_type === "cover_letter");

  if (!cvDoc) {
    const { data: activeResume } = await supabase
      .from("resumes")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activeResume) {
      return NextResponse.json(
        {
          error:
            "Please upload your PDF CV in 'My CV' before approving an email application so it can be attached.",
        },
        { status: 400 }
      );
    }

    const { data: insertedCvDoc } = await supabase
      .from("application_documents")
      .upsert(
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
      )
      .select("*")
      .single();

    cvDoc = insertedCvDoc;
  }

  if (!cvDoc || !coverLetterDoc) {
    return NextResponse.json(
      {
        error:
          "Both CV PDF and Cover Letter PDF attachments are required to approve email sending.",
      },
      { status: 400 }
    );
  }

  const approvalHash = computeApprovalHash({
    recipientEmail: recipientCheck.normalized,
    subject: app.email_subject,
    body: app.email_body,
    cvStoragePath: cvDoc.storage_path,
    cvSha256: cvDoc.content_sha256,
    coverLetterStoragePath: coverLetterDoc.storage_path,
    coverLetterSha256: coverLetterDoc.content_sha256,
  });

  const nowIso = new Date().toISOString();
  const { data: updated, error: upErr } = await supabase
    .from("applications")
    .update({
      recipient_email: recipientCheck.normalized,
      approval_status: "approved",
      approval_hash: approvalHash,
      approved_at: nowIso,
      approved_recipient: recipientCheck.normalized,
    })
    .eq("id", app.id)
    .eq("user_id", user.id)
    .select("*, documents:application_documents(*)")
    .single();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ application: updated });
}
