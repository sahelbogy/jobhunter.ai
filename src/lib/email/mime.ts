import crypto from "crypto";
import { escapeHtml } from "@/lib/security/sanitize";

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface MimeEmailInput {
  from: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachments: MimeAttachment[];
}

function encodeHeaderUtf8(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7E]*$/.test(clean)) {
    return clean;
  }
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/["\\\r\n]/g, "_").trim() || "document.pdf";
}

function chunkBase64(b64: string, lineLength = 76): string {
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += lineLength) {
    chunks.push(b64.slice(i, i + lineLength));
  }
  return chunks.join("\r\n");
}

/**
 * Builds a standards-compliant RFC 2822 multipart/mixed email with UTF-8 plain+HTML
 * body and base64 PDF attachments, encoded as base64url for Gmail API messages.send.
 */
export function buildGmailRawMimeMessage(input: MimeEmailInput): string {
  const mixedBoundary = `mixed_${crypto.randomBytes(12).toString("hex")}`;
  const altBoundary = `alt_${crypto.randomBytes(12).toString("hex")}`;

  const htmlParagraphs = input.textBody
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;line-height:1.6;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;">${escapeHtml(
          p
        ).replace(/\n/g, "<br/>")}</p>`
    )
    .join("");

  const htmlBody =
    input.htmlBody ||
    `<!DOCTYPE html><html><body style="margin:0;padding:16px;">${htmlParagraphs}</body></html>`;

  const lines: string[] = [
    `From: ${input.from.replace(/[\r\n]/g, "")}`,
    `To: ${input.to.replace(/[\r\n]/g, "")}`,
    `Subject: ${encodeHeaderUtf8(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    chunkBase64(Buffer.from(input.textBody, "utf8").toString("base64")),
    "",
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    chunkBase64(Buffer.from(htmlBody, "utf8").toString("base64")),
    "",
    `--${altBoundary}--`,
  ];

  for (const att of input.attachments) {
    const safeName = sanitizeFilename(att.filename);
    lines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${att.mimeType}; name="${safeName}"`,
      `Content-Disposition: attachment; filename="${safeName}"`,
      "Content-Transfer-Encoding: base64",
      "",
      chunkBase64(att.content.toString("base64")),
      ""
    );
  }

  lines.push(`--${mixedBoundary}--`, "");

  const rfc2822 = lines.join("\r\n");
  return Buffer.from(rfc2822, "utf8").toString("base64url");
}
