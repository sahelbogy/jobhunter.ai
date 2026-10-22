import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeApprovalHash } from "@/lib/security/approval";
import { validateRecipientEmail } from "@/lib/security/sanitize";
import { sendApprovedApplicationEmail } from "@/lib/email/sender";
import { getPublicEnv } from "@/lib/env";

export interface KapsoConfigStatus {
  configured: boolean;
  webhookSecretConfigured: boolean;
  baseUrl: string;
  phoneNumberIdConfigured: boolean;
}

export function getKapsoConfigStatus(): KapsoConfigStatus {
  const apiKey = process.env.KAPSO_API_KEY?.trim() || "";
  const phoneNumberId = process.env.KAPSO_PHONE_NUMBER_ID?.trim() || "";
  const webhookSecret = process.env.KAPSO_WEBHOOK_SECRET?.trim() || "";
  const baseUrl = (
    process.env.KAPSO_BASE_URL?.trim() || "https://api.kapso.ai/meta/whatsapp"
  ).replace(/\/+$/, "");

  return {
    configured: Boolean(apiKey && phoneNumberId),
    webhookSecretConfigured: Boolean(webhookSecret),
    baseUrl,
    phoneNumberIdConfigured: Boolean(phoneNumberId),
  };
}

/**
 * Normalizes a WhatsApp phone number to E.164 digits without '+' (as required by WhatsApp Cloud / Kapso API).
 * Automatically converts Moroccan local mobile format 06XXXXXXXX / 07XXXXXXXX to 2126XXXXXXXX / 2127XXXXXXXX.
 */
export function normalizeWhatsAppPhone(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";

  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (/^0[67]\d{8}$/.test(digits)) {
    digits = `212${digits.slice(1)}`;
  }

  digits = digits.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return "";
  }
  return digits;
}

function getKapsoCredentialsOrThrow() {
  const apiKey = process.env.KAPSO_API_KEY?.trim();
  const phoneNumberId = process.env.KAPSO_PHONE_NUMBER_ID?.trim();
  const baseUrl = (
    process.env.KAPSO_BASE_URL?.trim() || "https://api.kapso.ai/meta/whatsapp"
  ).replace(/\/+$/, "");

  if (!apiKey || !phoneNumberId) {
    throw new Error(
      "Kapso WhatsApp integration requires KAPSO_API_KEY and KAPSO_PHONE_NUMBER_ID in server environment variables."
    );
  }

  return {
    apiKey,
    phoneNumberId,
    endpoint: `${baseUrl}/v24.0/${encodeURIComponent(phoneNumberId)}/messages`,
  };
}

async function callKapsoMessagesApi(
  payload: Record<string, unknown>
): Promise<{ messageId: string | null }> {
  const { apiKey, endpoint } = getKapsoCredentialsOrThrow();

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Kapso WhatsApp API returned HTTP ${res.status}: ${errText.slice(0, 260)}`
    );
  }

  const data = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>;
  };

  return {
    messageId: data?.messages?.[0]?.id ?? null,
  };
}

export async function sendKapsoTextMessage(params: {
  to: string;
  body: string;
}): Promise<{ messageId: string | null }> {
  const normalizedTo = normalizeWhatsAppPhone(params.to);
  if (!normalizedTo) {
    throw new Error("Invalid WhatsApp phone number. Use E.164 format (e.g. +212612345678).");
  }

  return callKapsoMessagesApi({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizedTo,
    type: "text",
    text: {
      preview_url: false,
      body: params.body.slice(0, 4000),
    },
  });
}

export async function sendKapsoDocumentMessage(params: {
  to: string;
  documentUrl: string;
  filename: string;
  caption?: string;
}): Promise<{ messageId: string | null }> {
  const normalizedTo = normalizeWhatsAppPhone(params.to);
  if (!normalizedTo) {
    throw new Error("Invalid WhatsApp phone number.");
  }

  return callKapsoMessagesApi({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizedTo,
    type: "document",
    document: {
      link: params.documentUrl,
      filename: params.filename.slice(0, 120),
      ...(params.caption ? { caption: params.caption.slice(0, 900) } : {}),
    },
  });
}

export async function sendKapsoInteractiveApprovalCard(params: {
  to: string;
  headerText: string;
  bodyText: string;
  footerText: string;
  approvalCode: string;
  language: "fr" | "en";
}): Promise<{ messageId: string | null }> {
  const normalizedTo = normalizeWhatsAppPhone(params.to);
  if (!normalizedTo) {
    throw new Error("Invalid WhatsApp phone number.");
  }

  const approveTitle = params.language === "fr" ? "Approuver & Envoyer" : "Approve & Send";
  const rejectTitle = params.language === "fr" ? "Refuser" : "Reject";

  return callKapsoMessagesApi({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizedTo,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "text",
        text: params.headerText.slice(0, 60),
      },
      body: {
        text: params.bodyText.slice(0, 1020),
      },
      footer: {
        text: params.footerText.slice(0, 60),
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: `approve:${params.approvalCode}`,
              title: approveTitle.slice(0, 20),
            },
          },
          {
            type: "reply",
            reply: {
              id: `reject:${params.approvalCode}`,
              title: rejectTitle.slice(0, 20),
            },
          },
        ],
      },
    },
  });
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

export interface DispatchWhatsAppApprovalResult {
  dispatched: boolean;
  approvalCode?: string;
  kapsoMessageId?: string | null;
  reason?: string;
}

/**
 * Binds an awaiting-approval application cryptographically to its exact recipient, email body,
 * CV PDF, and Cover Letter PDF, records a pending row in `whatsapp_approval_requests`, and
 * dispatches the Cover Letter PDF + interactive Approve/Reject card via Kapso to WhatsApp.
 */
export async function dispatchApplicationToWhatsAppForApproval(params: {
  adminSupabase: SupabaseClient;
  userId: string;
  applicationId: string;
  whatsappPhone: string;
}): Promise<DispatchWhatsAppApprovalResult> {
  const { adminSupabase, userId, applicationId } = params;
  const normalizedPhone = normalizeWhatsAppPhone(params.whatsappPhone);
  if (!normalizedPhone) {
    return {
      dispatched: false,
      reason: "Invalid or missing WhatsApp phone number in Automation Settings.",
    };
  }

  const kapsoStatus = getKapsoConfigStatus();
  if (!kapsoStatus.configured) {
    return {
      dispatched: false,
      reason:
        "Kapso API credentials (KAPSO_API_KEY, KAPSO_PHONE_NUMBER_ID) require configuration.",
    };
  }

  const { data: app } = await adminSupabase
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!app) {
    return { dispatched: false, reason: "Application not found." };
  }

  const { data: docs } = await adminSupabase
    .from("application_documents")
    .select("*")
    .eq("application_id", app.id)
    .eq("user_id", userId);

  const cvDoc = (docs ?? []).find((d: any) => d.document_type === "cv");
  const clDoc = (docs ?? []).find((d: any) => d.document_type === "cover_letter");

  if (!clDoc) {
    return {
      dispatched: false,
      reason: "Cover letter PDF document is missing on this application.",
    };
  }

  const recipientCheck = validateRecipientEmail(app.recipient_email);
  const canonicalRecipient = recipientCheck.valid
    ? recipientCheck.normalized
    : "portal-only";

  if (recipientCheck.valid && !cvDoc) {
    return {
      dispatched: false,
      reason:
        "Upload an active CV PDF on /cv so approved WhatsApp emails can attach both your CV and Cover Letter.",
    };
  }

  const approvalHash = computeApprovalHash({
    recipientEmail: canonicalRecipient,
    subject: app.email_subject,
    body: app.email_body,
    cvStoragePath: cvDoc?.storage_path ?? "none",
    cvSha256: cvDoc?.content_sha256 ?? "none",
    coverLetterStoragePath: clDoc.storage_path,
    coverLetterSha256: clDoc.content_sha256,
  });

  // Expire any older pending request for this exact application
  await adminSupabase
    .from("whatsapp_approval_requests")
    .update({ status: "expired" })
    .eq("application_id", app.id)
    .eq("status", "pending");

  const approvalCode = generateApprovalShortCode();

  // Create a 72h signed link for the generated Cover Letter PDF
  const { data: signedCl } = await adminSupabase.storage
    .from(clDoc.storage_bucket)
    .createSignedUrl(clDoc.storage_path, 72 * 3600);

  const signedClUrl = signedCl?.signedUrl ?? null;

  // Send Cover Letter PDF document first if signed URL is publicly reachable
  if (signedClUrl) {
    await sendKapsoDocumentMessage({
      to: normalizedPhone,
      documentUrl: signedClUrl,
      filename: clDoc.file_name || "Cover_Letter.pdf",
      caption:
        app.language === "fr"
          ? `📄 Lettre de motivation PDF — ${app.job_title} (${app.company_name})`
          : `📄 Cover Letter PDF — ${app.job_title} (${app.company_name})`,
    }).catch(() => null);
  }

  const lang: "fr" | "en" = app.language === "fr" ? "fr" : "en";
  const recipientDisplay = recipientCheck.valid
    ? recipientCheck.normalized
    : lang === "fr"
      ? "Portail officiel (pas d'email public)"
      : "Official portal (no public email)";

  const bodySnippet = String(app.email_body || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 380);

  const bodyText =
    lang === "fr"
      ? [
          `🎯 *${app.job_title}* — *${app.company_name}*`,
          `📍 ${app.location}${app.match_score ? ` | Score: ${app.match_score}%` : ""}`,
          `📧 Destinataire: ${recipientDisplay}`,
          `✉️ Objet: ${String(app.email_subject || "").slice(0, 110)}`,
          ``,
          `📝 Aperçu du mail:`,
          `"${bodySnippet}${app.email_body?.length > 380 ? "…" : ""}"`,
          ``,
          `🔑 Code: *${approvalCode}* (ou répondez *OUI ${approvalCode}* / *NON ${approvalCode}*)`,
        ].join("\n")
      : [
          `🎯 *${app.job_title}* — *${app.company_name}*`,
          `📍 ${app.location}${app.match_score ? ` | Match: ${app.match_score}%` : ""}`,
          `📧 Recipient: ${recipientDisplay}`,
          `✉️ Subject: ${String(app.email_subject || "").slice(0, 110)}`,
          ``,
          `📝 Email preview:`,
          `"${bodySnippet}${app.email_body?.length > 380 ? "…" : ""}"`,
          ``,
          `🔑 Code: *${approvalCode}* (or reply *YES ${approvalCode}* / *NO ${approvalCode}*)`,
        ].join("\n");

  const headerText =
    lang === "fr"
      ? `Validation Candidature #${approvalCode}`
      : `Approve Application #${approvalCode}`;

  const footerText = recipientCheck.valid
    ? lang === "fr"
      ? "Envoi direct depuis votre email connecté"
      : "Sends directly from your connected email"
    : lang === "fr"
      ? "Validation dossier + lien portail"
      : "Approves package + portal link";

  const sentCard = await sendKapsoInteractiveApprovalCard({
    to: normalizedPhone,
    headerText,
    bodyText,
    footerText,
    approvalCode,
    language: lang,
  });

  await Promise.all([
    adminSupabase.from("whatsapp_approval_requests").insert({
      user_id: userId,
      application_id: app.id,
      approval_code: approvalCode,
      approval_hash: approvalHash,
      recipient_phone: normalizedPhone,
      kapso_message_id: sentCard.messageId,
      status: "pending",
    }),
    adminSupabase
      .from("applications")
      .update({
        approval_status: "awaiting_approval",
        tracking_status: "pending_approval",
        whatsapp_notified_at: new Date().toISOString(),
        whatsapp_message_id: sentCard.messageId,
      })
      .eq("id", app.id),
  ]);

  return {
    dispatched: true,
    approvalCode,
    kapsoMessageId: sentCard.messageId,
  };
}

/**
 * Verifies Kapso `X-Webhook-Signature` HMAC-SHA256 hex digest over exact raw request bytes.
 */
export function verifyKapsoWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined
): boolean {
  const cleanSecret = (secret ?? "").trim();
  const cleanSig = (signatureHeader ?? "")
    .trim()
    .replace(/^sha256=/i, "")
    .toLowerCase();

  if (!cleanSecret || !/^[a-f0-9]{64}$/.test(cleanSig)) {
    return false;
  }

  const expectedHex = crypto
    .createHmac("sha256", cleanSecret)
    .update(rawBody)
    .digest("hex")
    .toLowerCase();

  const a = Buffer.from(cleanSig, "hex");
  const b = Buffer.from(expectedHex, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface ParsedKapsoInboundMessage {
  messageId: string;
  fromPhone: string;
  decision: "approve" | "reject" | null;
  approvalCode: string | null;
  rawText: string;
}

function parseDecisionFromMessageObject(
  msg: Record<string, any>,
  fallbackPhone?: string
): ParsedKapsoInboundMessage | null {
  if (!msg || typeof msg !== "object") return null;

  // Ignore outbound echoes if present
  const direction = msg.kapso?.direction;
  if (direction === "outbound") return null;

  const fromPhone = normalizeWhatsAppPhone(
    String(msg.from || fallbackPhone || "")
  );
  if (!fromPhone) return null;

  const messageId = String(msg.id || crypto.randomUUID());

  // 1. Check interactive button reply (`approve:CODE` or `reject:CODE`)
  const buttonId = String(
    msg.interactive?.button_reply?.id || msg.button?.payload || ""
  ).trim();
  const buttonMatch = buttonId.match(/^(approve|reject):([A-Z0-9]{4,12})$/i);
  if (buttonMatch) {
    return {
      messageId,
      fromPhone,
      decision: buttonMatch[1].toLowerCase() as "approve" | "reject",
      approvalCode: buttonMatch[2].toUpperCase(),
      rawText: buttonId,
    };
  }

  // 2. Check plain text reply (e.g. "OUI K9M4P2", "APPROVE K9M4P2", "NON K9M4P2", or bare "OUI")
  const textBody = String(msg.text?.body ?? "").trim();
  if (!textBody) return null;

  const withCodeApprove = textBody.match(
    /^\s*(?:oui|yes|ok|approve|approuver|envoyer|send|valider)\s+#?([A-Z0-9]{6})\s*$/i
  );
  if (withCodeApprove) {
    return {
      messageId,
      fromPhone,
      decision: "approve",
      approvalCode: withCodeApprove[1].toUpperCase(),
      rawText: textBody,
    };
  }

  const withCodeReject = textBody.match(
    /^\s*(?:non|no|reject|refuser|annuler|cancel)\s+#?([A-Z0-9]{6})\s*$/i
  );
  if (withCodeReject) {
    return {
      messageId,
      fromPhone,
      decision: "reject",
      approvalCode: withCodeReject[1].toUpperCase(),
      rawText: textBody,
    };
  }

  if (/^\s*(?:oui|yes|approve|approuver|envoyer)\s*$/i.test(textBody)) {
    return {
      messageId,
      fromPhone,
      decision: "approve",
      approvalCode: null,
      rawText: textBody,
    };
  }

  if (/^\s*(?:non|no|reject|refuser|annuler)\s*$/i.test(textBody)) {
    return {
      messageId,
      fromPhone,
      decision: "reject",
      approvalCode: null,
      rawText: textBody,
    };
  }

  return {
    messageId,
    fromPhone,
    decision: null,
    approvalCode: null,
    rawText: textBody,
  };
}

/**
 * Extracts inbound WhatsApp user decisions from Kapso v2 webhooks (single or batched)
 * as well as Meta Cloud API v1 webhook format.
 */
export function extractKapsoInboundMessages(
  payload: unknown
): ParsedKapsoInboundMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, any>;
  const results: ParsedKapsoInboundMessage[] = [];

  // Kapso v2 batched: { data: [ { message, conversation }, ... ] }
  if (Array.isArray(body.data)) {
    for (const item of body.data) {
      const parsed = parseDecisionFromMessageObject(
        item?.message ?? item,
        item?.conversation?.phone_number
      );
      if (parsed) results.push(parsed);
    }
    return results;
  }

  // Kapso v2 single event: { message: {...}, conversation: {...} }
  if (body.message && typeof body.message === "object") {
    const parsed = parseDecisionFromMessageObject(
      body.message,
      body.conversation?.phone_number
    );
    if (parsed) results.push(parsed);
    return results;
  }

  // Meta WhatsApp Cloud v1 format: { entry: [{ changes: [{ value: { messages: [...] } }] }] }
  if (Array.isArray(body.entry)) {
    for (const entry of body.entry) {
      for (const change of entry?.changes ?? []) {
        for (const msg of change?.value?.messages ?? []) {
          const parsed = parseDecisionFromMessageObject(msg);
          if (parsed) results.push(parsed);
        }
      }
    }
  }

  return results;
}

export interface KapsoDecisionOutcome {
  handled: boolean;
  status: string;
  applicationId?: string;
  detail: string;
}

/**
 * Executes a verified inbound WhatsApp approval or rejection:
 * - Enforces exact sender phone ownership + non-expired pending status
 * - Verifies exact SHA-256 approval_hash against current application + PDF attachments
 * - Upon approval, immediately dispatches the email from the user's connected email (Gmail OAuth / SMTP)
 *   and sends a real-time confirmation reply on WhatsApp via Kapso.
 */
export async function processKapsoInboundDecision(params: {
  adminSupabase: SupabaseClient;
  inbound: ParsedKapsoInboundMessage;
  webhookIdempotencyKey?: string | null;
}): Promise<KapsoDecisionOutcome> {
  const { adminSupabase, inbound } = params;

  if (!inbound.decision) {
    return {
      handled: false,
      status: "ignored_non_command",
      detail: "Message did not contain an approval or rejection command.",
    };
  }

  let query = adminSupabase
    .from("whatsapp_approval_requests")
    .select("*")
    .eq("recipient_phone", inbound.fromPhone)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (inbound.approvalCode) {
    query = query.eq("approval_code", inbound.approvalCode);
  }

  const { data: pendingRows } = await query.limit(3);

  if (!pendingRows || pendingRows.length === 0) {
    await sendKapsoTextMessage({
      to: inbound.fromPhone,
      body: inbound.approvalCode
        ? `⚠️ Aucune demande en attente trouvée pour le code ${inbound.approvalCode} (déjà traitée ou expirée).`
        : `⚠️ Aucune candidature en attente de validation pour ce numéro.`,
    }).catch(() => null);

    return {
      handled: false,
      status: "no_matching_pending_request",
      detail: "No pending approval request matched phone + code.",
    };
  }

  // Safety rule: if multiple offers are pending and the user texted bare "OUI" without tapping a button or code, ask for the exact code!
  if (!inbound.approvalCode && pendingRows.length > 1) {
    const codes = pendingRows.map((r: any) => r.approval_code).join(", ");
    await sendKapsoTextMessage({
      to: inbound.fromPhone,
      body: `🔒 Vous avez plusieurs candidatures en attente (${codes}). Cliquez sur le bouton *Approuver & Envoyer* de l'offre choisie ou répondez *OUI <CODE>*.`,
    }).catch(() => null);

    return {
      handled: true,
      status: "ambiguous_multiple_pending",
      detail: "Prompted user to specify exact approval code.",
    };
  }

  const reqRow = pendingRows[0];

  // Check expiration
  if (reqRow.expires_at && new Date(reqRow.expires_at).getTime() < Date.now()) {
    await adminSupabase
      .from("whatsapp_approval_requests")
      .update({ status: "expired" })
      .eq("id", reqRow.id);

    await sendKapsoTextMessage({
      to: inbound.fromPhone,
      body: `⏰ La demande #${reqRow.approval_code} a expiré. Relancez la validation depuis AI Job Hunter.`,
    }).catch(() => null);

    return {
      handled: true,
      status: "expired",
      applicationId: reqRow.application_id,
      detail: "Approval request expired.",
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
      handled: false,
      status: "application_missing",
      detail: "Application record no longer exists.",
    };
  }

  // Handle REJECTION
  if (inbound.decision === "reject") {
    const nowIso = new Date().toISOString();
    await Promise.all([
      adminSupabase
        .from("whatsapp_approval_requests")
        .update({
          status: "rejected",
          responded_at: nowIso,
          webhook_idempotency_key: params.webhookIdempotencyKey ?? null,
        })
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

    await sendKapsoTextMessage({
      to: inbound.fromPhone,
      body: `🛑 Candidature annulée (#${reqRow.approval_code}) pour *${app.job_title}* chez *${app.company_name}*. Aucun email n'a été envoyé.`,
    }).catch(() => null);

    return {
      handled: true,
      status: "rejected",
      applicationId: app.id,
      detail: "Application rejected via WhatsApp.",
    };
  }

  // Handle APPROVAL: verify cryptographic integrity first!
  const { data: docs } = await adminSupabase
    .from("application_documents")
    .select("*")
    .eq("application_id", app.id)
    .eq("user_id", reqRow.user_id);

  const cvDoc = (docs ?? []).find((d: any) => d.document_type === "cv");
  const clDoc = (docs ?? []).find((d: any) => d.document_type === "cover_letter");

  const recipientCheck = validateRecipientEmail(app.recipient_email);
  const canonicalRecipient = recipientCheck.valid
    ? recipientCheck.normalized
    : "portal-only";

  const currentHash = computeApprovalHash({
    recipientEmail: canonicalRecipient,
    subject: app.email_subject,
    body: app.email_body,
    cvStoragePath: cvDoc?.storage_path ?? "none",
    cvSha256: cvDoc?.content_sha256 ?? "none",
    coverLetterStoragePath: clDoc?.storage_path ?? "none",
    coverLetterSha256: clDoc?.content_sha256 ?? "none",
  });

  if (currentHash !== reqRow.approval_hash) {
    await adminSupabase
      .from("whatsapp_approval_requests")
      .update({
        status: "expired",
        error_message:
          "Draft modified after WhatsApp dispatch; re-approval required.",
      })
      .eq("id", reqRow.id);

    await sendKapsoTextMessage({
      to: inbound.fromPhone,
      body: `🔒 Sécurité: Le brouillon #${reqRow.approval_code} a été modifié après l'envoi sur WhatsApp. Veuillez renvoyer la nouvelle version pour validation.`,
    }).catch(() => null);

    return {
      handled: true,
      status: "hash_mismatch_blocked",
      applicationId: app.id,
      detail: "Blocked stale approval because application content changed.",
    };
  }

  const nowIso = new Date().toISOString();

  // Persist cryptographic approval on application
  await adminSupabase
    .from("applications")
    .update({
      approval_status: "approved",
      approval_hash: currentHash,
      approved_at: nowIso,
      approved_recipient: canonicalRecipient,
    })
    .eq("id", app.id);

  // Check user's auto_send_on_whatsapp_approval setting
  const { data: autoSettings } = await adminSupabase
    .from("automation_settings")
    .select("auto_send_on_whatsapp_approval")
    .eq("user_id", reqRow.user_id)
    .maybeSingle();

  const shouldAutoSend = autoSettings?.auto_send_on_whatsapp_approval !== false;

  // Case A: Official portal-only offer (no verified public recruitment email)
  if (!recipientCheck.valid) {
    await adminSupabase
      .from("whatsapp_approval_requests")
      .update({
        status: "approved_portal_only",
        responded_at: nowIso,
        webhook_idempotency_key: params.webhookIdempotencyKey ?? null,
      })
      .eq("id", reqRow.id);

    const { appUrl } = getPublicEnv();
    await sendKapsoTextMessage({
      to: inbound.fromPhone,
      body: `✅ Dossier validé (#${reqRow.approval_code}) pour *${app.job_title}* chez *${app.company_name}*.\nCette entreprise utilise un portail officiel sans email public: postulez directement ici 👉 ${app.job_url || `${appUrl}/approvals`}`,
    }).catch(() => null);

    return {
      handled: true,
      status: "approved_portal_only",
      applicationId: app.id,
      detail: "Approved portal-only application (no verified email address).",
    };
  }

  if (!shouldAutoSend) {
    await adminSupabase
      .from("whatsapp_approval_requests")
      .update({
        status: "approved_queued",
        responded_at: nowIso,
        webhook_idempotency_key: params.webhookIdempotencyKey ?? null,
      })
      .eq("id", reqRow.id);

    await sendKapsoTextMessage({
      to: inbound.fromPhone,
      body: `✅ Candidature #${reqRow.approval_code} approuvée ! Prête pour envoi dans votre File d'approbation.`,
    }).catch(() => null);

    return {
      handled: true,
      status: "approved_queued",
      applicationId: app.id,
      detail: "Approved application queued for manual email trigger.",
    };
  }

  // Case B: Verified recipient email -> Immediately dispatch from user's connected email!
  try {
    const sendResult = await sendApprovedApplicationEmail({
      userId: reqRow.user_id,
      applicationId: app.id,
    });

    await Promise.all([
      adminSupabase
        .from("whatsapp_approval_requests")
        .update({
          status: "approved_and_sent",
          responded_at: nowIso,
          webhook_idempotency_key: params.webhookIdempotencyKey ?? null,
        })
        .eq("id", reqRow.id),
      adminSupabase.from("notifications").insert({
        user_id: reqRow.user_id,
        title: `WhatsApp Approved & Sent: ${app.company_name}`,
        message: `Your application for '${app.job_title}' was approved on WhatsApp (#${reqRow.approval_code}) and sent via ${sendResult.provider.toUpperCase()} to ${recipientCheck.normalized}.`,
        category: "email",
        link_url: "/tracker",
      }),
    ]);

    await sendKapsoTextMessage({
      to: inbound.fromPhone,
      body: `🚀 *Candidature envoyée avec succès !* (#${reqRow.approval_code})\n• Poste: *${app.job_title}* (${app.company_name})\n• Envoyé depuis votre boîte mail (${sendResult.provider.toUpperCase()}) à: ${recipientCheck.normalized}\n• Pièces jointes: CV + Lettre de motivation PDF`,
    }).catch(() => null);

    return {
      handled: true,
      status: "approved_and_sent",
      applicationId: app.id,
      detail: sendResult.deliverySummary,
    };
  } catch (sendErr) {
    const errMessage =
      sendErr instanceof Error
        ? sendErr.message
        : "Email delivery failed after WhatsApp approval.";

    await adminSupabase
      .from("whatsapp_approval_requests")
      .update({
        status: "failed",
        responded_at: nowIso,
        error_message: errMessage,
        webhook_idempotency_key: params.webhookIdempotencyKey ?? null,
      })
      .eq("id", reqRow.id);

    await sendKapsoTextMessage({
      to: inbound.fromPhone,
      body: `⚠️ Candidature #${reqRow.approval_code} approuvée, mais l'envoi email a échoué: ${errMessage.slice(0, 220)}. Vérifiez votre connexion Gmail/SMTP dans Email Center.`,
    }).catch(() => null);

    return {
      handled: true,
      status: "failed",
      applicationId: app.id,
      detail: errMessage,
    };
  }
}
