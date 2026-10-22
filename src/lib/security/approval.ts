import crypto from "crypto";

export interface ApprovalBindingPayload {
  recipientEmail: string;
  subject: string;
  body: string;
  cvStoragePath: string;
  cvSha256: string;
  coverLetterStoragePath: string;
  coverLetterSha256: string;
}

/**
 * Computes a deterministic cryptographic SHA-256 fingerprint binding an explicit user
 * approval to the EXACT recipient email, subject, email body, CV attachment, and
 * generated Cover Letter PDF.
 *
 * Any modification to recipient, subject, body, or attachments produces a different
 * hash and invalidates prior approval.
 */
export function computeApprovalHash(payload: ApprovalBindingPayload): string {
  const canonical = JSON.stringify({
    v: 1,
    recipient: payload.recipientEmail.trim().toLowerCase(),
    subject: payload.subject.trim(),
    body: payload.body.replace(/\r\n/g, "\n").trim(),
    cvPath: payload.cvStoragePath.trim(),
    cvSha256: payload.cvSha256.trim().toLowerCase(),
    coverLetterPath: payload.coverLetterStoragePath.trim(),
    coverLetterSha256: payload.coverLetterSha256.trim().toLowerCase(),
  });

  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function verifyApprovalIntegrity(
  storedApprovalStatus: string,
  storedApprovalHash: string | null | undefined,
  currentPayload: ApprovalBindingPayload
): { approved: boolean; currentHash: string; reason?: string } {
  const currentHash = computeApprovalHash(currentPayload);

  if (storedApprovalStatus !== "approved") {
    return {
      approved: false,
      currentHash,
      reason: `Application status is '${storedApprovalStatus}', not 'approved'. Explicit approval is required before sending.`,
    };
  }

  if (!storedApprovalHash) {
    return {
      approved: false,
      currentHash,
      reason: "Missing cryptographic approval signature.",
    };
  }

  const storedBuf = Buffer.from(storedApprovalHash, "utf8");
  const currentBuf = Buffer.from(currentHash, "utf8");

  if (
    storedBuf.length !== currentBuf.length ||
    !crypto.timingSafeEqual(storedBuf, currentBuf)
  ) {
    return {
      approved: false,
      currentHash,
      reason:
        "Application recipient, email content, or attachments changed after approval. Re-approval is mandatory.",
    };
  }

  return { approved: true, currentHash };
}

/**
 * Generates a deterministic idempotency key preventing duplicate email sends
 * for the same user, job/application, and recipient address.
 */
export function computeEmailIdempotencyKey(params: {
  userId: string;
  jobId?: string | null;
  applicationId: string;
  recipientEmail: string;
}): string {
  const targetKey = params.jobId ? `job:${params.jobId}` : `app:${params.applicationId}`;
  const raw = `${params.userId.trim()}|${targetKey}|${params.recipientEmail
    .trim()
    .toLowerCase()}`;
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}
