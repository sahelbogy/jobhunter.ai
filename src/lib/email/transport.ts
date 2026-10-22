import nodemailer from "nodemailer";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/security/encryption";
import { getValidGmailAccessToken } from "@/lib/email/gmail-oauth";
import {
  buildGmailRawMimeMessage,
  type MimeAttachment,
} from "@/lib/email/mime";

export interface StoredSmtpCredentials {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function inferDefaultSmtpHost(emailAddress: string): {
  host: string;
  port: number;
} {
  const domain = emailAddress.split("@")[1]?.toLowerCase() ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return { host: "smtp.gmail.com", port: 465 };
  }
  if (
    domain === "outlook.com" ||
    domain === "hotmail.com" ||
    domain === "live.com" ||
    domain === "msn.com"
  ) {
    return { host: "smtp.office365.com", port: 587 };
  }
  if (domain.startsWith("yahoo.")) {
    return { host: "smtp.mail.yahoo.com", port: 465 };
  }
  return { host: "", port: 587 };
}

export function resolveSmtpCredentials(connection: {
  email_address: string;
  encrypted_refresh_token?: string | null;
}): StoredSmtpCredentials {
  if (connection.encrypted_refresh_token) {
    try {
      const parsed = JSON.parse(
        decryptSecret(connection.encrypted_refresh_token)
      ) as Partial<StoredSmtpCredentials>;
      if (parsed.host && parsed.user && parsed.pass) {
        return {
          host: parsed.host.trim(),
          port: Number(parsed.port || 465),
          user: parsed.user.trim(),
          pass: parsed.pass,
          from: (parsed.from || connection.email_address || parsed.user).trim(),
        };
      }
    } catch {
      // Fall back to server env SMTP below
    }
  }

  const host = process.env.SMTP_HOST?.trim() || "";
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASS?.trim() || "";
  const from =
    process.env.SMTP_FROM?.trim() || connection.email_address || user;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP credentials are missing. Connect your Gmail App Password or SMTP credentials in Email Center (/emails)."
    );
  }

  return { host, port, user, pass, from };
}

export async function dispatchThroughUserEmailConnection(params: {
  userId: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachments?: MimeAttachment[];
}): Promise<{
  provider: "gmail" | "smtp";
  senderEmail: string;
  connectionId: string;
  messageId: string;
  threadId: string | null;
}> {
  const admin = createAdminSupabaseClient();
  const { data: connection } = await admin
    .from("email_connections")
    .select("*")
    .eq("user_id", params.userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!connection) {
    throw new Error(
      "Aucune boîte email connectée. Connectez votre Gmail (Mot de passe d'application gratuit ou OAuth) dans Email Center (/emails)."
    );
  }

  const attachments = params.attachments ?? [];

  if (connection.provider === "gmail") {
    const gmailAuth = await getValidGmailAccessToken(params.userId);
    const rawMime = buildGmailRawMimeMessage({
      from: gmailAuth.emailAddress,
      to: params.to,
      subject: params.subject,
      textBody: params.textBody,
      htmlBody: params.htmlBody,
      attachments,
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

    return {
      provider: "gmail",
      senderEmail: gmailAuth.emailAddress,
      connectionId: connection.id,
      messageId: String(sendJson.id),
      threadId: sendJson.threadId ? String(sendJson.threadId) : null,
    };
  }

  const smtp = resolveSmtpCredentials(connection);
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  const info = await transporter.sendMail({
    from: smtp.from,
    to: params.to,
    subject: params.subject,
    text: params.textBody,
    ...(params.htmlBody ? { html: params.htmlBody } : {}),
    attachments: attachments.map((att) => ({
      filename: att.filename,
      content: att.content,
      contentType: att.mimeType,
    })),
  });

  return {
    provider: "smtp",
    senderEmail: smtp.from,
    connectionId: connection.id,
    messageId: info.messageId || `smtp-${Date.now()}`,
    threadId: null,
  };
}
