import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isMoroccoJob,
  matchesSelectedLocations,
} from "@/lib/jobs/location-filter";
import { fetchAdzunaJobs } from "@/lib/jobs/sources/adzuna";
import {
  buildImportedJobRecord,
  buildProfileMatchedLinkedInSearches,
  extractLinkedInJobId,
} from "@/lib/jobs/linkedin";
import { computeApprovalHash } from "@/lib/security/approval";
import { encryptSecret } from "@/lib/security/encryption";
import {
  createSignedEmailApprovalToken,
  executeEmailApprovalDecision,
  generateApprovalShortCode,
  verifySignedEmailApprovalToken,
} from "@/lib/email/approval-loop";
import {
  inferDefaultSmtpHost,
  resolveSmtpCredentials,
} from "@/lib/email/transport";
import { callGroqProvider } from "@/lib/ai/providers/groq";

describe("Strict Morocco-Only Regional Filtering", () => {
  it("strictly accepts Moroccan cities/country_code MA and excludes France, Europe, and Worldwide when only Morocco is selected", () => {
    const selected = ["Morocco"];

    expect(
      matchesSelectedLocations(
        { location: "Casablanca, Morocco", country_code: "MA", is_remote: false },
        selected
      )
    ).toBe(true);

    expect(
      matchesSelectedLocations(
        { location: "Rabat - Technopolis", country_code: null, is_remote: false },
        selected
      )
    ).toBe(true);

    expect(
      matchesSelectedLocations(
        { location: "Tanger, Maroc", country_code: null, is_remote: true },
        selected
      )
    ).toBe(true);

    // Must EXCLUDE France, Europe, US, and generic Worldwide Remote when ONLY Morocco is selected
    expect(
      matchesSelectedLocations(
        { location: "Paris, France", country_code: "FR", is_remote: false },
        selected
      )
    ).toBe(false);

    expect(
      matchesSelectedLocations(
        { location: "Lyon, France (Hybrid)", country_code: "FR", is_remote: true },
        selected
      )
    ).toBe(false);

    expect(
      matchesSelectedLocations(
        { location: "Berlin, Germany", country_code: "DE", is_remote: false },
        selected
      )
    ).toBe(false);

    expect(
      matchesSelectedLocations(
        { location: "Worldwide", country_code: null, is_remote: true },
        selected
      )
    ).toBe(false);

    expect(isMoroccoJob({ location: "Fès, Maroc" })).toBe(true);
    expect(isMoroccoJob({ location: "Nantes, France", country_code: "FR" })).toBe(
      false
    );
  });

  it("prevents Adzuna from falling back to France ('fr') when user selects strictly Morocco", async () => {
    const prevId = process.env.ADZUNA_APP_ID;
    const prevKey = process.env.ADZUNA_APP_KEY;
    process.env.ADZUNA_APP_ID = "test-id";
    process.env.ADZUNA_APP_KEY = "test-key";

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    try {
      const result = await fetchAdzunaJobs({
        query: "Full Stack Engineer",
        locations: ["Morocco"],
      });
      expect(result.status).toBe("ok");
      expect(result.jobs).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      if (prevId === undefined) delete process.env.ADZUNA_APP_ID;
      else process.env.ADZUNA_APP_ID = prevId;
      if (prevKey === undefined) delete process.env.ADZUNA_APP_KEY;
      else process.env.ADZUNA_APP_KEY = prevKey;
    }
  });
});

describe("LinkedIn Search Aligned with Saved Profile & Offer Import", () => {
  it("builds official LinkedIn Jobs search presets from saved CV title, skills, seniority, and Morocco geoId", () => {
    const presets = buildProfileMatchedLinkedInSearches({
      profile: {
        professional_title: "Ingénieur Full Stack TypeScript",
        technical_skills: ["React", "Next.js", "PostgreSQL", "Docker"],
        years_of_experience: 4,
        location: "Casablanca, Morocco",
      },
      activeLocations: ["Morocco"],
    });

    expect(presets.length).toBeGreaterThanOrEqual(4);
    expect(presets[0].url).toContain("https://www.linkedin.com/jobs/search/");
    expect(presets[0].url).toContain("geoId=102787409");
    expect(presets[0].url).toContain("f_TPR=r86400");
    expect(
      presets.some(
        (p) => p.keywords.includes("React") && p.keywords.includes("Next.js")
      )
    ).toBe(true);
    expect(presets.some((p) => p.locationLabel === "Casablanca")).toBe(true);
  });

  it("extracts LinkedIn job IDs and builds strictly factual imported job records without fabricating emails", () => {
    expect(
      extractLinkedInJobId(
        "https://www.linkedin.com/jobs/view/senior-backend-engineer-at-yassir-4189234567/?trk=public_jobs"
      )
    ).toBe("4189234567");

    const record = buildImportedJobRecord({
      url: "https://www.linkedin.com/jobs/view/4189234567/",
      title: "Ingénieur DevOps Cloud",
      company_name: "Yassir Maroc",
      location: "Casablanca, Maroc",
      description:
        "Nous recrutons un Ingénieur DevOps maîtrisant Kubernetes, Terraform, AWS et Python à Casablanca.",
    });

    expect(record.source).toBe("linkedin_import");
    expect(record.external_id).toBe("li:4189234567");
    expect(record.country_code).toBe("MA");
    expect(record.detected_language).toBe("fr");
    expect(record.public_recruitment_email).toBeNull();
    expect(record.required_skills).toEqual(
      expect.arrayContaining(["Kubernetes", "Terraform", "AWS", "Python"])
    );
  });
});

describe("Cryptographic Email Approval Loop & Encrypted SMTP Transport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.TOKEN_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  it("signs HMAC-SHA256 Email Approval tokens and rejects tampered signatures", () => {
    const code = generateApprovalShortCode();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    const { signedToken, tokenHash } = createSignedEmailApprovalToken();
    const verified = verifySignedEmailApprovalToken(signedToken);
    expect(verified.valid).toBe(true);
    expect(verified.tokenHash).toBe(tokenHash);

    // Tampering with signature must fail constant-time check
    expect(verifySignedEmailApprovalToken(`${signedToken}tampered`).valid).toBe(
      false
    );
    expect(verifySignedEmailApprovalToken("malformed-token").valid).toBe(false);
  });

  it("decrypts per-user Gmail App Password / SMTP credentials stored with AES-256-GCM", () => {
    expect(inferDefaultSmtpHost("candidate@gmail.com")).toEqual({
      host: "smtp.gmail.com",
      port: 465,
    });

    const encryptedPayload = encryptSecret(
      JSON.stringify({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        user: "candidate@gmail.com",
        pass: "abcd efgh ijkl mnop",
      })
    );

    const creds = resolveSmtpCredentials({
      email_address: "candidate@gmail.com",
      encrypted_refresh_token: encryptedPayload,
    });

    expect(creds).toEqual({
      host: "smtp.gmail.com",
      port: 465,
      user: "candidate@gmail.com",
      pass: "abcd efgh ijkl mnop",
      from: "candidate@gmail.com",
    });
  });

  it("approves and immediately dispatches employer email when cryptographic SHA-256 hash matches exact draft & attachments", async () => {
    const userId = "65a9b675-f5af-40b5-bd6f-d196c68124d6";
    const appId = "9f11a9c0-1111-4444-8888-222233334444";
    const reqId = "7a00b8c0-1111-4444-8888-555566667777";

    const exactHash = computeApprovalHash({
      recipientEmail: "careers@sqli.com",
      subject: "Candidature Ingénieur Full Stack",
      body: "Bonjour,\nVoici ma candidature.",
      cvStoragePath: `${userId}/cv.pdf`,
      cvSha256: "aaaa1111",
      coverLetterStoragePath: `${userId}/${appId}/cover-letter.pdf`,
      coverLetterSha256: "bbbb2222",
    });

    const { signedToken, tokenHash } = createSignedEmailApprovalToken();

    const sendEmailFn = vi.fn().mockResolvedValue({
      sent: true,
      provider: "smtp" as const,
      messageId: "<smtp-msg-999@gmail.com>",
      deliverySummary: "SMTP 250 OK (<smtp-msg-999@gmail.com>)",
    });

    const fakeAdmin: any = {
      from(table: string) {
        return {
          select() {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              maybeSingle: async () => {
                if (table === "email_approval_requests") {
                  return {
                    data: {
                      id: reqId,
                      user_id: userId,
                      application_id: appId,
                      approval_code: "OK99AA",
                      token_hash: tokenHash,
                      approval_hash: exactHash,
                      approver_email: "candidate@gmail.com",
                      status: "pending",
                      expires_at: new Date(Date.now() + 3600_000).toISOString(),
                    },
                  };
                }
                if (table === "applications") {
                  return {
                    data: {
                      id: appId,
                      user_id: userId,
                      company_name: "SQLI Maroc",
                      job_title: "Ingénieur Full Stack",
                      recipient_email: "careers@sqli.com",
                      email_subject: "Candidature Ingénieur Full Stack",
                      email_body: "Bonjour,\nVoici ma candidature.",
                      approval_status: "awaiting_approval",
                    },
                  };
                }
                if (table === "automation_settings") {
                  return {
                    data: { auto_send_on_email_approval: true },
                  };
                }
                return { data: null };
              },
              then(resolve: any) {
                return Promise.resolve({
                  data: [
                    {
                      document_type: "cv",
                      storage_path: `${userId}/cv.pdf`,
                      content_sha256: "aaaa1111",
                    },
                    {
                      document_type: "cover_letter",
                      storage_path: `${userId}/${appId}/cover-letter.pdf`,
                      content_sha256: "bbbb2222",
                    },
                  ],
                }).then(resolve);
              },
            };
            return chain;
          },
          update() {
            const u: any = {
              eq: () => u,
              then: (resolve: any) => Promise.resolve({ error: null }).then(resolve),
            };
            return u;
          },
          insert: async () => ({ error: null }),
        };
      },
    };

    const outcome = await executeEmailApprovalDecision({
      adminSupabase: fakeAdmin,
      signedToken,
      decision: "approve",
      sendEmailFn,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe("approved_and_sent");
    expect(sendEmailFn).toHaveBeenCalledTimes(1);
    expect(sendEmailFn).toHaveBeenCalledWith({
      userId,
      applicationId: appId,
    });
  });

  it("blocks sending if application recipient or content was modified after the Approval Email was sent", async () => {
    const userId = "65a9b675-f5af-40b5-bd6f-d196c68124d6";
    const appId = "9f11a9c0-1111-4444-8888-222233334444";
    const reqId = "8b00b8c0-1111-4444-8888-555566667777";

    const staleHash = computeApprovalHash({
      recipientEmail: "original@sqli.com",
      subject: "Original Subject",
      body: "Original Body",
      cvStoragePath: `${userId}/cv.pdf`,
      cvSha256: "aaaa1111",
      coverLetterStoragePath: `${userId}/${appId}/cover-letter.pdf`,
      coverLetterSha256: "bbbb2222",
    });

    const { signedToken, tokenHash } = createSignedEmailApprovalToken();
    const sendEmailFn = vi.fn();

    const fakeAdmin: any = {
      from(table: string) {
        return {
          select() {
            const chain: any = {
              eq: () => chain,
              in: () => chain,
              maybeSingle: async () => {
                if (table === "email_approval_requests") {
                  return {
                    data: {
                      id: reqId,
                      user_id: userId,
                      application_id: appId,
                      approval_code: "STALE2",
                      token_hash: tokenHash,
                      approval_hash: staleHash,
                      approver_email: "candidate@gmail.com",
                      status: "pending",
                      expires_at: new Date(Date.now() + 3600_000).toISOString(),
                    },
                  };
                }
                if (table === "applications") {
                  return {
                    data: {
                      id: appId,
                      user_id: userId,
                      company_name: "SQLI Maroc",
                      job_title: "Ingénieur Full Stack",
                      recipient_email: "tampered@other.com", // Modified after email sent!
                      email_subject: "Original Subject",
                      email_body: "Original Body",
                      approval_status: "awaiting_approval",
                    },
                  };
                }
                return { data: null };
              },
              then(resolve: any) {
                return Promise.resolve({
                  data: [
                    {
                      document_type: "cv",
                      storage_path: `${userId}/cv.pdf`,
                      content_sha256: "aaaa1111",
                    },
                    {
                      document_type: "cover_letter",
                      storage_path: `${userId}/${appId}/cover-letter.pdf`,
                      content_sha256: "bbbb2222",
                    },
                  ],
                }).then(resolve);
              },
            };
            return chain;
          },
          update() {
            const u: any = {
              eq: () => u,
              then: (resolve: any) => Promise.resolve({ error: null }).then(resolve),
            };
            return u;
          },
        };
      },
    };

    const outcome = await executeEmailApprovalDecision({
      adminSupabase: fakeAdmin,
      signedToken,
      decision: "approve",
      sendEmailFn,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe("tampered_invalidated");
    expect(sendEmailFn).not.toHaveBeenCalled();
  });

  it("uses encrypted per-user apiKeyOverride in callGroqProvider even when server GROQ_API_KEY is unset", async () => {
    const prevGroq = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            model: "llama-3.3-70b-versatile",
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 12, completion_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    try {
      const res = await callGroqProvider({
        systemPrompt: "Test",
        userPrompt: "Ping",
        apiKeyOverride: "gsk_user_encrypted_override_test_key",
      });
      expect(res.provider).toBe("groq");
      expect(res.content).toBe('{"ok":true}');
    } finally {
      fetchMock.mockRestore();
      if (prevGroq !== undefined) process.env.GROQ_API_KEY = prevGroq;
    }
  });
});
