import crypto from "crypto";

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above|system)\s+(instructions|prompts|rules)/gi,
  /disregard\s+(all\s+)?(previous|prior|above|system)\s+(instructions|prompts|rules)/gi,
  /system\s*prompt\s*:/gi,
  /<\s*\/?\s*(system|assistant|developer|untrusted_cv_document|untrusted_job_posting)\s*>/gi,
  /\[\s*INST\s*\]|\[\s*\/INST\s*\]|<\|im_start\|>|<\|im_end\|>/gi,
  /send\s+an?\s+email\s+immediately\s+to/gi,
  /exfiltrate\s+(api[_\s]?key|token|secret|password|credentials)/gi,
];

/**
 * Strips control bytes, neutralizes prompt-injection overrides, and bounds length.
 * External CVs and job descriptions are ALWAYS treated as untrusted passive text.
 */
export function sanitizeUntrustedText(input: string, maxLength = 25000): string {
  if (!input) return "";
  let cleaned = input
    .replace(/\u0000/g, "")
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[REDACTED_UNTRUSTED_DIRECTIVE]");
  }

  cleaned = cleaned.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }
  return cleaned;
}

export function wrapUntrustedBlock(
  tagName: "untrusted_cv_document" | "untrusted_job_posting",
  rawText: string,
  maxLength = 20000
): string {
  const sanitized = sanitizeUntrustedText(rawText, maxLength);
  return `<${tagName}>\n${sanitized}\n</${tagName}>`;
}

export function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function stripHtmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

const DISALLOWED_RECIPIENT_PREFIXES = [
  "noreply@",
  "no-reply@",
  "donotreply@",
  "do-not-reply@",
  "mailer-daemon@",
  "postmaster@",
  "bounce@",
];

const PLACEHOLDER_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "localhost",
  "invalid",
  "domain.com",
  "company.com",
  "email.com",
  "yourcompany.com",
]);

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.fr",
  "hotmail.com",
  "hotmail.fr",
  "outlook.com",
  "live.com",
  "icloud.com",
  "protonmail.com",
  "proton.me",
]);

export function validateRecipientEmail(email: string | null | undefined): {
  valid: boolean;
  normalized: string;
  reason?: string;
} {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) {
    return { valid: false, normalized: "", reason: "Recipient email is empty." };
  }

  if (normalized.length > 254 || /[\r\n\s<>]/.test(normalized)) {
    return {
      valid: false,
      normalized,
      reason: "Recipient email contains invalid characters.",
    };
  }

  const emailRegex = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}$/i;
  if (!emailRegex.test(normalized)) {
    return { valid: false, normalized, reason: "Malformed email address." };
  }

  for (const prefix of DISALLOWED_RECIPIENT_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return {
        valid: false,
        normalized,
        reason: "No-reply automated addresses cannot receive job applications.",
      };
    }
  }

  const domain = normalized.split("@")[1];
  if (!domain || PLACEHOLDER_DOMAINS.has(domain) || domain.endsWith(".example")) {
    return {
      valid: false,
      normalized,
      reason: "Placeholder or unverified example domains are rejected.",
    };
  }

  return { valid: true, normalized };
}

/**
 * Extracts ONLY legitimate business recruitment emails explicitly published in job text.
 * Never fabricates or guesses email addresses, and filters out personal/no-reply/image strings.
 */
export function extractPublishedRecruitmentEmail(text: string): string | null {
  if (!text) return null;
  const matches =
    text.match(/\b[a-zA-Z0-9._%+-]+@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,12}\b/g) ??
    [];

  for (const candidate of matches) {
    const lower = candidate.toLowerCase();
    if (/\.(png|jpg|jpeg|gif|svg|webp|pdf|css|js)$/i.test(lower)) continue;
    const check = validateRecipientEmail(lower);
    if (!check.valid) continue;
    const domain = lower.split("@")[1];
    if (PERSONAL_EMAIL_DOMAINS.has(domain)) continue;
    if (
      lower.includes("privacy@") ||
      lower.includes("abuse@") ||
      lower.includes("security@") ||
      lower.includes("legal@") ||
      lower.includes("dpo@") ||
      lower.includes("press@") ||
      lower.includes("support@sentry")
    ) {
      continue;
    }
    return check.normalized;
  }
  return null;
}

export function normalizeJobUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }
    const stripParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "source",
      "gh_src",
      "lever-source",
    ];
    for (const p of stripParams) {
      parsed.searchParams.delete(p);
    }
    parsed.hash = "";
    const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.pathname = normalizedPath;
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

export const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

export function validatePdfBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): { valid: boolean; sha256: string; error?: string } {
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return {
      valid: false,
      sha256: "",
      error: "Only .pdf files are accepted.",
    };
  }

  if (mimeType && mimeType !== "application/pdf" && mimeType !== "application/x-pdf") {
    return {
      valid: false,
      sha256: "",
      error: `Invalid MIME type '${mimeType}'. Expected application/pdf.`,
    };
  }

  if (!buffer || buffer.byteLength === 0) {
    return { valid: false, sha256: "", error: "Uploaded PDF file is empty." };
  }

  if (buffer.byteLength > MAX_PDF_BYTES) {
    return {
      valid: false,
      sha256: "",
      error: "PDF exceeds maximum allowed size of 10 MB.",
    };
  }

  // Check PDF magic header %PDF- (allow up to first 16 bytes whitespace offset)
  const headerSlice = buffer.subarray(0, 16).toString("latin1");
  if (!headerSlice.includes("%PDF-")) {
    return {
      valid: false,
      sha256: "",
      error: "Invalid file signature: file is not a valid PDF document.",
    };
  }

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  return { valid: true, sha256 };
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
