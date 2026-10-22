import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeApprovalHash } from "@/lib/security/approval";
import {
  escapeHtml,
  sha256Hex,
  validateRecipientEmail,
} from "@/lib/security/sanitize";
import { getPublicEnv } from "@/lib/env";
import { dispatchThroughUserEmailConnection } from "@/lib/email/transport";
import { sendApprovedApplicationEmail } from "@/lib/email/sender";

function getApprovalSigningSecret(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY?.trim() || "";
  if (key.length < 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY (min 32 chars) is required for cryptographic email approval tokens."
    );
  }
  return crypto
    .createHash("sha256")
    .update(`ai-job-hunter-email-approval:${key}`)
    .digest();
}

export function generateApprovalShortCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function createSignedEmailApprovalToken(): {
  signedToken: string;
  tokenHash: string;
} {
  const rawToken = crypto.randomBytes(24).toString("base64url");
  const tokenHash = sha256Hex(rawToken);
  const sig = crypto
    .createHmac("sha256", getApprovalSigningSecret())
    .update(`email-approval:v1:${rawToken}`)
    .digest("base64url");

  return {
    signedToken: `${rawToken}.${sig}`,
    tokenHash,
  };
}

export function verifySignedEmailApprovalToken(signedToken: string): {
  valid: boolean;
  tokenHash?: string;
} {
  if (!signedToken || typeof signedToken !== "string") {
    return { valid: false };
  }
  const parts = signedToken.trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false };
  }

  const [rawToken, providedSig] = parts;
  let expectedSig: string;
  try {
    expectedSig = crypto
      .createHmac("sha256", getApprovalSigningSecret())
      .update(`email-approval:v1:${rawToken}`)
      .digest("base64url");
  } catch {
    return { valid: false };
  }

  const a = Buffer.from(providedSig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false };
  }

  return {
    valid: true,
    tokenHash: sha256Hex(rawToken),
  };
}

export interface DispatchEmailApprovalResult {
  dispatched: boolean;
  approvalCode?: string;
  approverEmail?: string;
  emailMessageId?: string | null;
  reason?: string;
}

/**
 * Binds an awaiting-approval application cryptographically to its exact recipient, email body,
 * CV PDF, and Cover Letter PDF, records a pending row in `email_approval_requests` (with hashed token),
 * and sends a rich HTML approval email (with Cover Letter PDF attached + Approve/Reject links)
 * directly to the user's inbox via their connected email account.
 */
export async function dispatchApplicationToEmailForApproval(params: {
  adminSupabase: SupabaseClient;
  userId: string;
  applicationId: string;
  approverEmail?: string | null;
}): Promise<DispatchEmailApprovalResult> {
  const { adminSupabase, userId, applicationId } = params;

  const [{ data: app }, { data: settings }, { data: conn }, { data: profile }] =
    await Promise.all([
      adminSupabase
        .from("applications")
        .select("*")
        .eq("id", applicationId)
        .eq("user_id", userId)
        .maybeSingle(),
      adminSupabase
        .from("automation_settings")
        .select("approval_email_recipient")
        .eq("user_id", userId)
        .maybeSingle(),
      adminSupabase
        .from("email_connections")
        .select("email_address, is_active")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle(),
      adminSupabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", userId)
        .maybeSingle(),
    ]);

  if (!app) {
    return { dispatched: false, reason: "Application not found." };
  }

  if (!conn?.is_active) {
    return {
      dispatched: false,
      reason:
        "Connectez votre boîte email dans Email Center (/emails) pour recevoir les emails de validation et envoyer vos candidatures.",
    };
  }

  const rawApprover =
    params.approverEmail?.trim() ||
    settings?.approval_email_recipient?.trim() ||
    conn.email_address?.trim() ||
    profile?.email?.trim() ||
    "";
  const approverCheck = validateRecipientEmail(rawApprover);
  if (!approverCheck.valid) {
    return {
      dispatched: false,
      reason:
        "Adresse email de validation invalide. Vérifiez votre email dans Email Center ou Automation Settings.",
    };
  }

  const { data: docs } = await adminSupabase
    .from("application_documents")
    .select("*")
    .eq("application_id", app.id)
    .eq("user_id", userId);

  const cvDoc = (docs ?? []).find((d: any) => d.document_type === "cv");
  const clDoc = (docs ?? []).find(
    (d: any) => d.document_type === "cover_letter"
  );

  if (!clDoc) {
    return {
      dispatched: false,
      reason: "Cover letter PDF document is missing on this application.",
    };
  }

  const employerRecipientCheck = validateRecipientEmail(app.recipient_email);
  const canonicalRecipient = employerRecipientCheck.valid
    ? employerRecipientCheck.normalized
    : "portal-only";

  if (employerRecipientCheck.valid && !cvDoc) {
    return {
      dispatched: false,
      reason:
        "Importez un CV PDF actif dans /cv afin que les candidatures validées par email joignent votre CV + Lettre de Motivation.",
    };
  }

  const approvalHash = computeApprovalHash({
    recipientEmail: canonicalRecipient,
    subject: app.email_subject,
    body: app.email_body,
    cvStoragePath: cvDoc?.storage_path ?? null,
    cvSha256: cvDoc?.content_sha256 ?? null,
    coverLetterStoragePath: clDoc.storage_path,
    coverLetterSha256: clDoc.content_sha256,
  });

  // Download Cover Letter PDF so the user can inspect the exact PDF directly in their inbox
  const { data: clBlob, error: clDlErr } = await adminSupabase.storage
    .from(clDoc.storage_bucket)
    .download(clDoc.storage_path);

  if (clDlErr || !clBlob) {
    return {
      dispatched: false,
      reason: "Could not download Cover Letter PDF from private storage.",
    };
  }
  const clBuffer = Buffer.from(await clBlob.arrayBuffer());

  const approvalCode = generateApprovalShortCode();
  const { signedToken, tokenHash } = createSignedEmailApprovalToken();
  const expiresAt = new Date(
    Date.now() + 72 * 60 * 60 * 1000
  ).toISOString();

  // Invalidate any previous pending requests for this application
  await adminSupabase
    .from("email_approval_requests")
    .update({ status: "invalidated" })
    .eq("application_id", app.id)
    .eq("status", "pending");

  const { data: insertedReq, error: insErr } = await adminSupabase
    .from("email_approval_requests")
    .insert({
      user_id: userId,
      application_id: app.id,
      approval_code: approvalCode,
      token_hash: tokenHash,
      approval_hash: approvalHash,
      approver_email: approverCheck.normalized,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insErr || !insertedReq) {
    return {
      dispatched: false,
      reason: `Failed to record approval request: ${insErr?.message ?? "DB error"}`,
    };
  }

  const { appUrl } = getPublicEnv();
  const approveUrl = `${appUrl}/api/applications/email-approval?token=${encodeURIComponent(signedToken)}&action=approve`;
  const rejectUrl = `${appUrl}/api/applications/email-approval?token=${encodeURIComponent(signedToken)}&action=reject`;
  const queueUrl = `${appUrl}/approvals`;

  const isFr = app.language !== "en";
  const mailSubject = isFr
    ? `[Validation #${approvalCode}] ${app.job_title} chez ${app.company_name} — Approuver ou Refuser`
    : `[Approval #${approvalCode}] ${app.job_title} at ${app.company_name} — Approve or Reject`;

  const destLabel = employerRecipientCheck.valid
    ? employerRecipientCheck.normalized
    : isFr
      ? `Portail officiel (aucun email public vérifié) : ${app.job_url || "N/A"}`
      : `Official portal (no verified public email): ${app.job_url || "N/A"}`;

  const textBody = [
    `AI JOB HUNTER — ${isFr ? "VALIDATION DE CANDIDATURE" : "APPLICATION APPROVAL"} (#${approvalCode})`,
    "",
    `${isFr ? "Poste" : "Role"}: ${app.job_title}`,
    `${isFr ? "Entreprise" : "Company"}: ${app.company_name} (${app.location || "N/A"})`,
    `${isFr ? "Score IA" : "Match Score"}: ${app.match_score != null ? `${app.match_score}%` : "N/A"}`,
    `${isFr ? "Destinataire employeur" : "Employer recipient"}: ${destLabel}`,
    "",
    `--- ${isFr ? "OBJET DU MAIL GÉNÉRÉ" : "GENERATED EMAIL SUBJECT"} ---`,
    app.email_subject,
    "",
    `--- ${isFr ? "CORPS DU MAIL GÉNÉRÉ" : "GENERATED EMAIL BODY"} ---`,
    app.email_body,
    "",
    `${isFr ? "Approuver & Envoyer" : "Approve & Send"}: ${approveUrl}`,
    `${isFr ? "Refuser" : "Reject"}: ${rejectUrl}`,
  ].join("\n");

  const htmlBody = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:20px 24px;color:#ffffff;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;opacity:0.9;">AI Job Hunter • Code #${escapeHtml(approvalCode)}</div>
      <h2 style="margin:6px 0 0 0;font-size:19px;">${escapeHtml(app.job_title)} — ${escapeHtml(app.company_name)}</h2>
      <p style="margin:4px 0 0 0;font-size:13px;opacity:0.92;">${escapeHtml(app.location || "")}${app.match_score != null ? ` • Score IA : ${Number(app.match_score)}%` : ""}</p>
    </div>
    <div style="padding:24px;">
      <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:18px;">
        <strong>${isFr ? "Destinataire employeur vérifié :" : "Verified employer recipient:"}</strong>
        <span style="color:#1d4ed8;"> ${escapeHtml(destLabel)}</span><br/>
        <strong>${isFr ? "Pièces jointes prêtes :" : "Prepared attachments:"}</strong>
        ${cvDoc ? `${escapeHtml(cvDoc.file_name)} + ` : ""}${escapeHtml(clDoc.file_name)} <em>(${isFr ? "Lettre PDF jointe à cet email pour relecture" : "Cover Letter PDF attached to this email for review"})</em>
      </div>

      <div style="margin-bottom:18px;">
        <div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;margin-bottom:4px;">${isFr ? "Objet de la candidature" : "Application Subject"}</div>
        <div style="padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(app.email_subject)}</div>
      </div>

      <div style="margin-bottom:22px;">
        <div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;margin-bottom:4px;">${isFr ? "Message personnalisé généré" : "Generated Personalized Email"}</div>
        <div style="padding:14px;border:1px solid #e2e8f0;border-radius:8px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;background:#fafafa;">${escapeHtml(app.email_body)}</div>
      </div>

      <div style="margin:24px 0;text-align:center;">
        <a href="${escapeHtml(approveUrl)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px;margin:0 8px 10px 0;">
          ✅ ${isFr ? "Approuver &amp; Envoyer la Candidature" : "Approve &amp; Send Application"}
        </a>
        <a href="${escapeHtml(rejectUrl)}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 18px;border-radius:10px;margin:0 0 10px 0;">
          🛑 ${isFr ? "Refuser" : "Reject"}
        </a>
      </div>

      <p style="font-size:12px;color:#64748b;line-height:1.5;margin:16px 0 0 0;border-top:1px solid #e2e8f0;padding-top:12px;">
        🔒 ${isFr ? "Garantie sécurité : aucun email n'est envoyé au recruteur tant que vous n'avez pas confirmé. Toute modification dans" : "Security guarantee: no email is sent to any employer until you confirm. Editing in"}
        <a href="${escapeHtml(queueUrl)}" style="color:#2563eb;">Approval Queue</a>
        ${isFr ? "invalide automatiquement ce lien." : "automatically invalidates this link."}
      </p>
    </div>
  </div>
</body>
</html>`;

  try {
    const sent = await dispatchThroughUserEmailConnection({
      userId,
      to: approverCheck.normalized,
      subject: mailSubject,
      textBody,
      htmlBody,
      attachments: [
        {
          filename: clDoc.file_name,
          mimeType: "application/pdf",
          content: clBuffer,
        },
      ],
    });

    const nowIso = new Date().toISOString();
    await Promise.all([
      adminSupabase
        .from("email_approval_requests")
        .update({ email_message_id: sent.messageId })
        .eq("id", insertedReq.id),
      adminSupabase
        .from("applications")
        .update({ approval_email_sent_at: nowIso })
        .eq("id", app.id),
    ]);

    return {
      dispatched: true,
      approvalCode,
      approverEmail: approverCheck.normalized,
      emailMessageId: sent.messageId,
    };
  } catch (err) {
    await adminSupabase
      .from("email_approval_requests")
      .update({ status: "invalidated" })
      .eq("id", insertedReq.id);

    return {
      dispatched: false,
      reason:
        err instanceof Error
          ? err.message
          : "Failed to send approval email.",
    };
  }
}

export interface EmailApprovalDecisionOutcome {
  ok: boolean;
  status:
    | "approved_and_sent"
    | "approved_portal_ready"
    | "approved_queued"
    | "rejected"
    | "tampered_invalidated"
    | "expired"
    | "invalid_token"
    | "already_processed"
    | "send_failed";
  applicationId?: string;
  jobTitle?: string;
  companyName?: string;
  recipientEmail?: string | null;
  portalUrl?: string | null;
  message: string;
}

export async function inspectPendingEmailApprovalToken(params: {
  adminSupabase: SupabaseClient;
  signedToken: string;
}): Promise<{
  valid: boolean;
  reason?: string;
  requestRow?: Record<string, any>;
  application?: Record<string, any>;
}> {
  const verified = verifySignedEmailApprovalToken(params.signedToken);
  if (!verified.valid || !verified.tokenHash) {
    return { valid: false, reason: "Lien de validation invalide ou signature incorrecte." };
  }

  const { data: reqRow } = await params.adminSupabase
    .from("email_approval_requests")
    .select("*")
    .eq("token_hash", verified.tokenHash)
    .maybeSingle();

  if (!reqRow) {
    return { valid: false, reason: "Demande de validation introuvable." };
  }

  if (reqRow.status !== "pending") {
    return {
      valid: false,
      reason: `Cette demande (#${reqRow.approval_code}) a déjà été traitée (statut : ${reqRow.status}).`,
    };
  }

  if (reqRow.expires_at && new Date(reqRow.expires_at).getTime() < Date.now()) {
    await params.adminSupabase
      .from("email_approval_requests")
      .update({ status: "expired" })
      .eq("id", reqRow.id);
    return { valid: false, reason: "Ce lien de validation a expiré." };
  }

  const { data: app } = await params.adminSupabase
    .from("applications")
    .select("*")
    .eq("id", reqRow.application_id)
    .eq("user_id", reqRow.user_id)
    .maybeSingle();

  if (!app) {
    return { valid: false, reason: "La candidature associée n'existe plus." };
  }

  return {
    valid: true,
    requestRow: reqRow,
    application: app,
  };
}

/**
 * Executes an explicit human confirmation (`POST`) on a signed email approval token:
 * - Verifies HMAC-SHA256 signature + DB `token_hash` + non-expired `pending` state
 * - Verifies exact `computeApprovalHash` against live recipient, subject, body, CV & Cover Letter SHA-256
 * - On approval, immediately dispatches the application email directly from the user's connected email!
 */
export async function executeEmailApprovalDecision(params: {
  adminSupabase: SupabaseClient;
  signedToken: string;
  decision: "approve" | "reject";
  sendEmailFn?: typeof sendApprovedApplicationEmail;
}): Promise<EmailApprovalDecisionOutcome> {
  const { adminSupabase, signedToken, decision } = params;
  const dispatchEmployerEmail = params.sendEmailFn ?? sendApprovedApplicationEmail;

  const verified = verifySignedEmailApprovalToken(signedToken);
  if (!verified.valid || !verified.tokenHash) {
    return {
      ok: false,
      status: "invalid_token",
      message: "Signature cryptographique invalide.",
    };
  }

  const { data: reqRow } = await adminSupabase
    .from("email_approval_requests")
    .select("*")
    .eq("token_hash", verified.tokenHash)
    .maybeSingle();

  if (!reqRow) {
    return {
      ok: false,
      status: "invalid_token",
      message: "Demande de validation introuvable.",
    };
  }

  if (reqRow.status !== "pending") {
    return {
      ok: false,
      status: "already_processed",
      applicationId: reqRow.application_id,
      message: `Cette demande (#${reqRow.approval_code}) a déjà été traitée (${reqRow.status}).`,
    };
  }

  if (reqRow.expires_at && new Date(reqRow.expires_at).getTime() < Date.now()) {
    await adminSupabase
      .from("email_approval_requests")
      .update({ status: "expired" })
      .eq("id", reqRow.id);
    return {
      ok: false,
      status: "expired",
      applicationId: reqRow.application_id,
      message: "Ce lien de validation a expiré.",
    };
  }

  const { data: app } = await adminSupabase
    .from("applications")
    .select("*")
    .eq("id", reqRow.application_id)
    .eq("user_id", reqRow.user_id)
    .maybeSingle();

  if (!app) {
    return {
      ok: false,
      status: "invalid_token",
      message: "Candidature introuvable.",
    };
  }

  if (decision === "reject") {
    const nowIso = new Date().toISOString();
    await Promise.all([
      adminSupabase
        .from("email_approval_requests")
        .update({ status: "rejected", responded_at: nowIso })
        .eq("id", reqRow.id),
      adminSupabase
        .from("applications")
        .update({
          approval_status: "rejected",
          tracking_status: "withdrawn",
          approval_hash: null,
        })
        .eq("id", app.id),
    ]);

    return {
      ok: true,
      status: "rejected",
      applicationId: app.id,
      jobTitle: app.job_title,
      companyName: app.company_name,
      message: `Candidature refusée (#${reqRow.approval_code}) pour ${app.job_title} chez ${app.company_name}. Aucun email n'a été envoyé.`,
    };
  }

  // Verify exact cryptographic approval_hash against live DB state before approving
  const { data: docs } = await adminSupabase
    .from("application_documents")
    .select("*")
    .eq("application_id", app.id)
    .eq("user_id", reqRow.user_id);

  const cvDoc = (docs ?? []).find((d: any) => d.document_type === "cv");
  const clDoc = (docs ?? []).find(
    (d: any) => d.document_type === "cover_letter"
  );

  const recipientCheck = validateRecipientEmail(app.recipient_email);
  const canonicalRecipient = recipientCheck.valid
    ? recipientCheck.normalized
    : "portal-only";

  const currentHash = computeApprovalHash({
    recipientEmail: canonicalRecipient,
    subject: app.email_subject,
    body: app.email_body,
    cvStoragePath: cvDoc?.storage_path ?? null,
    cvSha256: cvDoc?.content_sha256 ?? null,
    coverLetterStoragePath: clDoc?.storage_path ?? null,
    coverLetterSha256: clDoc?.content_sha256 ?? null,
  });

  if (currentHash !== reqRow.approval_hash) {
    await adminSupabase
      .from("email_approval_requests")
      .update({
        status: "invalidated",
        responded_at: new Date().toISOString(),
      })
      .eq("id", reqRow.id);

    return {
      ok: false,
      status: "tampered_invalidated",
      applicationId: app.id,
      jobTitle: app.job_title,
      companyName: app.company_name,
      message:
        "Sécurité : le destinataire, le texte ou les pièces jointes ont été modifiés après l'envoi de cet email de validation. Veuillez re-valider depuis Approval Queue.",
    };
  }

  const nowIso = new Date().toISOString();
  const { data: settings } = await adminSupabase
    .from("automation_settings")
    .select("auto_send_on_email_approval")
    .eq("user_id", reqRow.user_id)
    .maybeSingle();

  const autoSend = settings?.auto_send_on_email_approval !== false;

  await Promise.all([
    adminSupabase
      .from("email_approval_requests")
      .update({ status: "approved", responded_at: nowIso })
      .eq("id", reqRow.id),
    adminSupabase
      .from("applications")
      .update({
        approval_status: "approved",
        approval_hash: currentHash,
        approved_at: nowIso,
        approved_recipient: canonicalRecipient,
      })
      .eq("id", app.id),
  ]);

  if (!recipientCheck.valid) {
    return {
      ok: true,
      status: "approved_portal_ready",
      applicationId: app.id,
      jobTitle: app.job_title,
      companyName: app.company_name,
      portalUrl: app.job_url ?? null,
      message: `Candidature approuvée ! Cette offre ne publie pas d'email recruteur direct — postulez via le portail officiel avec votre Lettre de Motivation PDF générée.`,
    };
  }

  if (!autoSend) {
    return {
      ok: true,
      status: "approved_queued",
      applicationId: app.id,
      jobTitle: app.job_title,
      companyName: app.company_name,
      recipientEmail: recipientCheck.normalized,
      message: `Candidature approuvée (#${reqRow.approval_code}) et prête à être envoyée dans Approval Queue.`,
    };
  }

  try {
    const sendRes = await dispatchEmployerEmail({
      userId: reqRow.user_id,
      applicationId: app.id,
    });

    await adminSupabase.from("notifications").insert({
      user_id: reqRow.user_id,
      type: "application_sent",
      title: `Candidature envoyée : ${app.job_title} (${app.company_name})`,
      message: `Validée par email (#${reqRow.approval_code}) et envoyée directement à ${recipientCheck.normalized} (${sendRes.deliverySummary}).`,
      link: "/tracker",
    });

    return {
      ok: true,
      status: "approved_and_sent",
      applicationId: app.id,
      jobTitle: app.job_title,
      companyName: app.company_name,
      recipientEmail: recipientCheck.normalized,
      message: `Candidature approuvée et envoyée directement à ${recipientCheck.normalized} depuis votre boîte connectée (${sendRes.deliverySummary}) !`,
    };
  } catch (sendErr) {
    return {
      ok: false,
      status: "send_failed",
      applicationId: app.id,
      jobTitle: app.job_title,
      companyName: app.company_name,
      recipientEmail: recipientCheck.normalized,
      message:
        sendErr instanceof Error
          ? sendErr.message
          : "Échec lors de l'envoi de l'email au recruteur.",
    };
  }
}
