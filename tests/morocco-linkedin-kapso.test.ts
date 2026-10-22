import crypto from "node:crypto";
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
import {
  extractKapsoInboundMessages,
  normalizeWhatsAppPhone,
  processKapsoInboundDecision,
  resolveKapsoPhoneNumber,
  sendKapsoTemplateMessage,
  verifyKapsoWebhookSignature,
} from "@/lib/whatsapp/kapso";
import * as emailSender from "@/lib/email/sender";

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
    expect(presets[0].url).toContain("geoId=102787409"); // Official LinkedIn Morocco geoId
    expect(presets[0].url).toContain("f_TPR=r86400"); // Today (24h)
    expect(
      presets.some((p) => p.keywords.includes("React") && p.keywords.includes("Next.js"))
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

describe("Kapso WhatsApp Webhook Security, Button Approval & Direct Email Dispatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes Moroccan local and international WhatsApp numbers and verifies Kapso HMAC-SHA256 signatures", () => {
    expect(normalizeWhatsAppPhone("06 12 34 56 78")).toBe("212612345678");
    expect(normalizeWhatsAppPhone("+212 7 98 76 54 32")).toBe("212798765432");

    const rawBody = JSON.stringify({
      message: {
        id: "wamid.123",
        from: "212612345678",
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: { id: "approve:K9M4P2", title: "Approuver & Envoyer" },
        },
      },
    });
    const secret = "kapso_test_webhook_secret_32_chars";
    const validSig = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    expect(verifyKapsoWebhookSignature(rawBody, validSig, secret)).toBe(true);
    expect(
      verifyKapsoWebhookSignature(`${rawBody}tampered`, validSig, secret)
    ).toBe(false);
    expect(verifyKapsoWebhookSignature(rawBody, "0".repeat(64), secret)).toBe(
      false
    );

    const parsed = extractKapsoInboundMessages(JSON.parse(rawBody));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      fromPhone: "212612345678",
      decision: "approve",
      approvalCode: "K9M4P2",
    });
  });

  it("verifies cryptographic approval_hash on WhatsApp button approval and dispatches directly from user's connected email", async () => {
    const appId = "11111111-1111-4111-8111-111111111111";
    const userId = "22222222-2222-4222-8222-222222222222";
    const reqId = "33333333-3333-4333-8333-333333333333";

    const exactHash = computeApprovalHash({
      recipientEmail: "recrutement@alten.ma",
      subject: "Candidature Ingénieur Full Stack — Adam",
      body: "Madame, Monsieur, voici ma candidature.",
      cvStoragePath: `${userId}/cv.pdf`,
      cvSha256: "aaaa1111",
      coverLetterStoragePath: `${userId}/${appId}/cover-letter.pdf`,
      coverLetterSha256: "bbbb2222",
    });

    const sendSpy = vi
      .spyOn(emailSender, "sendApprovedApplicationEmail")
      .mockResolvedValue({
        sent: true,
        provider: "gmail",
        messageId: "gmail-msg-999",
        threadId: "gmail-thread-999",
        deliverySummary: "Sent via Gmail OAuth to recrutement@alten.ma",
      });

    const updates: Array<{ table: string; values: any }> = [];

    const fakeAdmin: any = {
      from(table: string) {
        return {
          select() {
            const chain: any = {
              eq() {
                return chain;
              },
              order() {
                return chain;
              },
              limit: async () => {
                if (table === "whatsapp_approval_requests") {
                  return {
                    data: [
                      {
                        id: reqId,
                        user_id: userId,
                        application_id: appId,
                        approval_code: "K9M4P2",
                        approval_hash: exactHash,
                        recipient_phone: "212612345678",
                        status: "pending",
                        expires_at: new Date(
                          Date.now() + 3600_000
                        ).toISOString(),
                      },
                    ],
                  };
                }
                return { data: [] };
              },
              maybeSingle: async () => {
                if (table === "applications") {
                  return {
                    data: {
                      id: appId,
                      user_id: userId,
                      company_name: "ALTEN Maroc",
                      job_title: "Ingénieur Full Stack",
                      recipient_email: "recrutement@alten.ma",
                      email_subject: "Candidature Ingénieur Full Stack — Adam",
                      email_body: "Madame, Monsieur, voici ma candidature.",
                      approval_status: "awaiting_approval",
                    },
                  };
                }
                if (table === "automation_settings") {
                  return {
                    data: { auto_send_on_whatsapp_approval: true },
                  };
                }
                return { data: null };
              },
              then(resolve: any) {
                if (table === "application_documents") {
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
                }
                return Promise.resolve({ data: [] }).then(resolve);
              },
            };
            return chain;
          },
          update(values: any) {
            updates.push({ table, values });
            return {
              eq: async () => ({ error: null }),
            };
          },
          insert: async (values: any) => {
            updates.push({ table: `${table}:insert`, values });
            return { error: null };
          },
        };
      },
    };

    const outcome = await processKapsoInboundDecision({
      adminSupabase: fakeAdmin,
      inbound: {
        messageId: "wamid.approve.1",
        fromPhone: "212612345678",
        decision: "approve",
        approvalCode: "K9M4P2",
        rawText: "approve:K9M4P2",
      },
      webhookIdempotencyKey: "idem-kapso-001",
    });

    expect(outcome.handled).toBe(true);
    expect(outcome.status).toBe("approved_and_sent");
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith({
      userId,
      applicationId: appId,
    });
    expect(
      updates.some(
        (u) =>
          u.table === "whatsapp_approval_requests" &&
          u.values.status === "approved_and_sent"
      )
    ).toBe(true);
  });

  it("blocks WhatsApp approval if email body or recipient was modified after the WhatsApp card was sent", async () => {
    const appId = "11111111-1111-4111-8111-111111111111";
    const userId = "22222222-2222-4222-8222-222222222222";
    const sendSpy = vi.spyOn(emailSender, "sendApprovedApplicationEmail");

    const staleHash = computeApprovalHash({
      recipientEmail: "recrutement@alten.ma",
      subject: "Original Subject",
      body: "Original Body",
      cvStoragePath: `${userId}/cv.pdf`,
      cvSha256: "aaaa1111",
      coverLetterStoragePath: `${userId}/${appId}/cover-letter.pdf`,
      coverLetterSha256: "bbbb2222",
    });

    const fakeAdmin: any = {
      from(table: string) {
        return {
          select() {
            const chain: any = {
              eq() {
                return chain;
              },
              order() {
                return chain;
              },
              limit: async () => ({
                data: [
                  {
                    id: "req-stale",
                    user_id: userId,
                    application_id: appId,
                    approval_code: "STALE1",
                    approval_hash: staleHash,
                    recipient_phone: "212612345678",
                    status: "pending",
                    expires_at: new Date(Date.now() + 3600_000).toISOString(),
                  },
                ],
              }),
              maybeSingle: async () => ({
                data: {
                  id: appId,
                  user_id: userId,
                  company_name: "ALTEN Maroc",
                  job_title: "Ingénieur Full Stack",
                  recipient_email: "tampered@other.com", // Modified after WhatsApp card!
                  email_subject: "Original Subject",
                  email_body: "Original Body",
                  approval_status: "awaiting_approval",
                },
              }),
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
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    };

    const outcome = await processKapsoInboundDecision({
      adminSupabase: fakeAdmin,
      inbound: {
        messageId: "wamid.approve.stale",
        fromPhone: "212612345678",
        decision: "approve",
        approvalCode: "STALE1",
        rawText: "approve:STALE1",
      },
    });

    expect(outcome.status).toBe("hash_mismatch_blocked");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("auto-discovers phone_number_id from Kapso Platform API using only KAPSO_API_KEY and sends template messages", async () => {
    const prevKey = process.env.KAPSO_API_KEY;
    const prevPhoneId = process.env.KAPSO_PHONE_NUMBER_ID;
    process.env.KAPSO_API_KEY = "test_kapso_project_key";
    delete process.env.KAPSO_PHONE_NUMBER_ID;

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: any) => {
        const url = String(input);
        if (url.includes("/platform/v1/whatsapp/phone_numbers")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "cfg_123",
                  phone_number_id: "109876543210987",
                  display_phone_number: "+1 555-019-9999",
                  business_account_id: "waba_999",
                  name: "jobhunter.ai",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/v24.0/109876543210987/messages")) {
          return new Response(
            JSON.stringify({ messages: [{ id: "wamid.first.prod.001" }] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not Found", { status: 404 });
      });

    try {
      const resolved = await resolveKapsoPhoneNumber();
      expect(resolved.phoneNumberId).toBe("109876543210987");
      expect(resolved.displayPhoneNumber).toBe("+1 555-019-9999");

      const sent = await sendKapsoTemplateMessage({
        to: "+212 614 192 699",
        templateName: "hello_world",
        languageCode: "en_US",
      });
      expect(sent.messageId).toBe("wamid.first.prod.001");
      expect(sent.phoneNumberId).toBe("109876543210987");
    } finally {
      fetchMock.mockRestore();
      if (prevKey === undefined) delete process.env.KAPSO_API_KEY;
      else process.env.KAPSO_API_KEY = prevKey;
      if (prevPhoneId !== undefined) process.env.KAPSO_PHONE_NUMBER_ID = prevPhoneId;
    }
  });
});
