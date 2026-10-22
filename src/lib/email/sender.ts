import nodemailer from "nodemailer";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  computeEmailIdempotencyKey,
  verifyApprovalIntegrity,
} from "@/lib/security/approval";
import { sha256Hex, validateRecipientEmail } from "@/lib/security/sanitize";
import { getValidGmailAccessToken } from "@/lib/email/gmail-oauth";
import { buildGmailRawMimeMessage } from "@/lib/email/mime";
import { resolveSmtpCredentials } from "@/lib/email/transport";

export interface SendApprovedApplicationResult {
  sent: boolean;
  provider: "gmail" | "smtp";
  messageId: string;
  threadId?: string | null;
  deliverySummary: string;
}

export async function sendApprovedApplicationEmail(params: {
  userId: string;
  applicationId: string;
}): Promise<SendApprovedApplicationResult> {
  const admin = createAdminSupabaseClient();

  // 1. Load application and enforce strict user ownership
  const { data: app, error: appErr } = await admin
    .from("applications")
    .select("*")
    .eq("id", params.applicationId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (appErr || !app) {
    throw new Error("Application record not found or access denied.");
  }

  if (app.approval_status === "sent") {
    throw new Error(
      "Duplicate-send blocked: this application has already been sent."
    );
  }

  if (app.approval_status === "sending") {
    throw new Error(
      "Application is currently in transit. Please wait before retrying."
    );
  }

  // 2. Validate recipient email strictly
  const recipientCheck = validateRecipientEmail(app.recipient_email);
  if (!recipientCheck.valid) {
    throw new Error(
      `Cannot send email: ${recipientCheck.reason ?? "Invalid recipient email."}`
    );
  }

  // Optional integration-testing safety fence: if SAFE_EMAIL_ALLOWLIST is set,
  // never send real emails outside the comma-separated allowlist.
  const allowlistRaw = process.env.SAFE_EMAIL_ALLOWLIST?.trim();
  if (allowlistRaw) {
    const allowed = allowlistRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(recipientCheck.normalized)) {
      throw new Error(
        `Safe testing mode active: recipient '${recipientCheck.normalized}' is not in SAFE_EMAIL_ALLOWLIST.`
      );
    }
  }

  // 3. Load attached CV + Cover Letter document records
  const { data: docs, error: docsErr } = await admin
    .from("application_documents")
    .select("*")
    .eq("application_id", app.id)
    .eq("user_id", params.userId);

  if (docsErr || !docs) {
    throw new Error("Failed to load application attachment records.");
  }

  const cvDoc = docs.find((d) => d.document_type === "cv");
  const coverLetterDoc = docs.find((d) => d.document_type === "cover_letter");

  if (!cvDoc || !coverLetterDoc) {
    throw new Error(
      "Both the original CV PDF and generated Cover Letter PDF must be attached and approved before sending."
    );
  }

  // 4. Verify cryptographic approval signature BEFORE downloading or sending
  const preSendApprovalCheck = verifyApprovalIntegrity(
    app.approval_status,
    app.approval_hash,
    {
      recipientEmail: recipientCheck.normalized,
      subject: app.email_subject,
      body: app.email_body,
      cvStoragePath: cvDoc.storage_path,
      cvSha256: cvDoc.content_sha256,
      coverLetterStoragePath: coverLetterDoc.storage_path,
      coverLetterSha256: coverLetterDoc.content_sha256,
    }
  );

  const idempotencyKey = computeEmailIdempotencyKey({
    userId: params.userId,
    jobId: app.job_id,
    applicationId: app.id,
    recipientEmail: recipientCheck.normalized,
  });

  if (!preSendApprovalCheck.approved) {
    await admin.from("email_logs").insert({
      user_id: params.userId,
      application_id: app.id,
      idempotency_key: `${idempotencyKey}:blocked:${Date.now()}`,
      recipient_email: recipientCheck.normalized,
      subject: app.email_subject,
      status: "blocked_unapproved",
      error_message: preSendApprovalCheck.reason,
    });
    throw new Error(
      preSendApprovalCheck.reason ??
        "Explicit approval is mandatory before sending."
    );
  }

  // 5. Check idempotency / duplicate-send log
  const { data: existingSentLog } = await admin
    .from("email_logs")
    .select("id, status, provider_message_id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingSentLog && existingSentLog.status === "sent") {
    throw new Error(
      `Duplicate-send prevented: an email for this opportunity was already sent to ${recipientCheck.normalized} (Message ID: ${existingSentLog.provider_message_id ?? "recorded"}).`
    );
  }

  // 6. Download CV & Cover Letter PDFs from private Supabase Storage and verify SHA-256 integrity
  const [{ data: cvBlob, error: cvDlErr }, { data: clBlob, error: clDlErr }] =
    await Promise.all([
      admin.storage.from(cvDoc.storage_bucket).download(cvDoc.storage_path),
      admin.storage
        .from(coverLetterDoc.storage_bucket)
        .download(coverLetterDoc.storage_path),
    ]);

  if (cvDlErr || !cvBlob) {
    throw new Error(
      `Could not retrieve CV PDF from private storage: ${cvDlErr?.message ?? "Missing file"}`
    );
  }
  if (clDlErr || !clBlob) {
    throw new Error(
      `Could not retrieve Cover Letter PDF from private storage: ${clDlErr?.message ?? "Missing file"}`
    );
  }

  const cvBuffer = Buffer.from(await cvBlob.arrayBuffer());
  const clBuffer = Buffer.from(await clBlob.arrayBuffer());

  if (sha256Hex(cvBuffer) !== cvDoc.content_sha256) {
    throw new Error(
      "CV file checksum mismatch since approval. Please review and re-approve the application."
    );
  }
  if (sha256Hex(clBuffer) !== coverLetterDoc.content_sha256) {
    throw new Error(
      "Cover Letter PDF checksum mismatch since approval. Please review and re-approve the application."
    );
  }

  // 7. Check user's connected email account & enforce daily sending quota
  const { data: connection } = await admin
    .from("email_connections")
    .select("*")
    .eq("user_id", params.userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!connection) {
    throw new Error(
      "No active email account connected. Connect Gmail (or SMTP) in Email Center before sending."
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const effectiveSendsToday =
    connection.quota_reset_date === todayIso ? connection.sends_today : 0;

  if (effectiveSendsToday >= connection.daily_send_limit) {
    await admin.from("email_logs").insert({
      user_id: params.userId,
      application_id: app.id,
      connection_id: connection.id,
      idempotency_key: `${idempotencyKey}:ratelimit:${Date.now()}`,
      recipient_email: recipientCheck.normalized,
      subject: app.email_subject,
      status: "blocked_rate_limit",
      provider: connection.provider,
      error_message: `Daily sending limit (${connection.daily_send_limit}/day) reached.`,
    });
    throw new Error(
      `Daily sending limit (${connection.daily_send_limit} emails/day) reached. Try again tomorrow or adjust your limit.`
    );
  }

  // Transition application atomically to 'sending'
  const { data: lockedApp, error: lockErr } = await admin
    .from("applications")
    .update({ approval_status: "sending" })
    .eq("id", app.id)
    .eq("approval_status", "approved")
    .select("id")
    .maybeSingle();

  if (lockErr || !lockedApp) {
    throw new Error("Application is no longer in approved state or already sending.");
  }

  const attachmentsMeta = [
    {
      type: "cv",
      filename: cvDoc.file_name,
      bytes: cvBuffer.byteLength,
      sha256: cvDoc.content_sha256,
    },
    {
      type: "cover_letter",
      filename: coverLetterDoc.file_name,
      bytes: clBuffer.byteLength,
      sha256: coverLetterDoc.content_sha256,
    },
  ];

  try {
    let providerMessageId = "";
    let providerThreadId: string | null = null;

    if (connection.provider === "gmail") {
      const gmailAuth = await getValidGmailAccessToken(params.userId);
      const rawMime = buildGmailRawMimeMessage({
        from: gmailAuth.emailAddress,
        to: recipientCheck.normalized,
        subject: app.email_subject,
        textBody: app.email_body,
        attachments: [
          {
            filename: cvDoc.file_name,
            mimeType: "application/pdf",
            content: cvBuffer,
          },
          {
            filename: coverLetterDoc.file_name,
            mimeType: "application/pdf",
            content: clBuffer,
          },
        ],
      });

      const sendRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gmailAuth.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw: rawMime }),
          signal: AbortSignal.timeout(20000),
        }
      );

      const sendJson = (await sendRes.json()) as Record<string, any>;
      if (!sendRes.ok || !sendJson.id) {
        throw new Error(
          sendJson?.error?.message ||
            `Gmail API rejected message (HTTP ${sendRes.status}).`
        );
      }

      providerMessageId = String(sendJson.id);
      providerThreadId = sendJson.threadId ? String(sendJson.threadId) : null;
    } else {
      const smtp = resolveSmtpCredentials(connection);
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: { user: smtp.user, pass: smtp.pass },
      });

      const info = await transporter.sendMail({
        from: smtp.from,
        to: recipientCheck.normalized,
        subject: app.email_subject,
        text: app.email_body,
        attachments: [
          {
            filename: cvDoc.file_name,
            content: cvBuffer,
            contentType: "application/pdf",
          },
          {
            filename: coverLetterDoc.file_name,
            content: clBuffer,
            contentType: "application/pdf",
          },
        ],
      });
      providerMessageId = info.messageId || `smtp-${Date.now()}`;
    }

    const nowIso = new Date().toISOString();
    const followUp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const deliverySummary = `Accepted for dispatch by ${connection.provider.toUpperCase()} (ID: ${providerMessageId})`;

    await Promise.all([
      admin
        .from("applications")
        .update({
          approval_status: "sent",
          tracking_status: "sent",
          sent_at: nowIso,
          applied_at: nowIso,
          gmail_message_id: providerMessageId,
          gmail_thread_id: providerThreadId,
          email_delivery_result: deliverySummary,
          follow_up_date: app.follow_up_date ?? followUp,
        })
        .eq("id", app.id),
      admin.from("email_logs").upsert(
        {
          user_id: params.userId,
          application_id: app.id,
          connection_id: connection.id,
          idempotency_key: idempotencyKey,
          recipient_email: recipientCheck.normalized,
          subject: app.email_subject,
          approval_hash_verified: preSendApprovalCheck.currentHash,
          attachments_meta: attachmentsMeta,
          status: "sent",
          provider: connection.provider,
          provider_message_id: providerMessageId,
          provider_thread_id: providerThreadId,
          sent_at: nowIso,
        },
        { onConflict: "idempotency_key" }
      ),
      admin
        .from("email_connections")
        .update({
          sends_today: effectiveSendsToday + 1,
          quota_reset_date: todayIso,
          last_error: null,
        })
        .eq("id", connection.id),
      admin.from("notifications").insert({
        user_id: params.userId,
        title: `Application Sent — ${app.company_name}`,
        message: `Your approved application for ${app.job_title} was sent to ${recipientCheck.normalized}.`,
        category: "email",
        link_url: "/tracker",
      }),
    ]);

    return {
      sent: true,
      provider: connection.provider,
      messageId: providerMessageId,
      threadId: providerThreadId,
      deliverySummary,
    };
  } catch (sendErr) {
    const errMsg =
      sendErr instanceof Error ? sendErr.message : "Failed to send email.";

    await Promise.all([
      admin
        .from("applications")
        .update({
          approval_status: "failed",
          email_delivery_result: `Send failed: ${errMsg}`,
        })
        .eq("id", app.id),
      admin.from("email_logs").insert({
        user_id: params.userId,
        application_id: app.id,
        connection_id: connection.id,
        idempotency_key: `${idempotencyKey}:err:${Date.now()}`,
        recipient_email: recipientCheck.normalized,
        subject: app.email_subject,
        approval_hash_verified: preSendApprovalCheck.currentHash,
        attachments_meta: attachmentsMeta,
        status: "failed",
        provider: connection.provider,
        error_message: errMsg,
      }),
    ]);

    throw new Error(errMsg);
  }
}
