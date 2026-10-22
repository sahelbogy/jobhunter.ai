import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { executeAiTask } from "@/lib/ai/orchestrator";
import {
  buildGmailAuthorizationUrl,
  exchangeGmailCodeAndPersist,
  verifyGmailOAuthState,
} from "@/lib/email/gmail-oauth";
import { buildGmailRawMimeMessage } from "@/lib/email/mime";
import { computeApprovalHash } from "@/lib/security/approval";

const mockSupabaseState: {
  application: any;
  documents: any[];
  existingEmailLog: any;
  upsertedConnection: any;
} = {
  application: null,
  documents: [],
  existingEmailLog: null,
  upsertedConnection: null,
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_c1: string, _v1: string) => ({
          eq: (_c2: string, _v2: string) => ({
            maybeSingle: async () => {
              if (table === "applications") {
                return { data: mockSupabaseState.application, error: null };
              }
              if (table === "email_logs") {
                return {
                  data: mockSupabaseState.existingEmailLog,
                  error: null,
                };
              }
              return { data: null, error: null };
            },
            then: (resolve: any) =>
              resolve({
                data:
                  table === "application_documents"
                    ? mockSupabaseState.documents
                    : [],
                error: null,
              }),
          }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      upsert: async (payload: any) => {
        if (table === "email_connections") {
          mockSupabaseState.upsertedConnection = payload;
        }
        return { data: payload, error: null };
      },
      update: () => ({
        eq: async () => ({ error: null }),
      }),
      insert: async () => ({ error: null }),
    }),
  }),
}));

import { sendApprovedApplicationEmail } from "@/lib/email/sender";

describe("Modular AI Orchestrator, Gmail OAuth 2.0 & Approved Email Sender", () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("never silently switches to a secondary or paid AI provider without explicit authorization", async () => {
    process.env.GROQ_API_KEY = "gsk_primary";
    process.env.GEMINI_API_KEY = "gem_fallback";
    process.env.XAI_API_KEY = "xai_paid";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "Rate limit reached" } }),
        { status: 429 }
      )
    );

    // 1. No fallback configured -> throws immediately, never calls Gemini/xAI
    await expect(
      executeAiTask({
        taskType: "connection_test",
        routing: { primaryProvider: "groq", fallbackProvider: null },
        request: {
          systemPrompt: "Sys",
          userPrompt: "Ping",
          jsonMode: false,
        },
      })
    ).rejects.toThrow(/Rate limit/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 2. Paid fallback (xAI) blocked when allowPaidFallback is false
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Groq down" } }), {
        status: 503,
      })
    );
    await expect(
      executeAiTask({
        taskType: "connection_test",
        routing: {
          primaryProvider: "groq",
          fallbackProvider: "xai",
          allowPaidFallback: false,
        },
        request: { systemPrompt: "Sys", userPrompt: "Ping" },
      })
    ).rejects.toThrow(/Allow Paid Fallback/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 3. Explicit Gemini fallback succeeds cleanly
    fetchSpy.mockClear();
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Groq outage" } }), {
          status: 503,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: '{"status":"ok"}' }] } },
            ],
            usageMetadata: {
              promptTokenCount: 15,
              candidatesTokenCount: 5,
            },
          }),
          { status: 200 }
        )
      );

    const res = await executeAiTask({
      taskType: "connection_test",
      routing: { primaryProvider: "groq", fallbackProvider: "gemini" },
      request: {
        systemPrompt: "Sys",
        userPrompt: "Return JSON",
        jsonMode: true,
      },
    });
    expect(res.provider).toBe("gemini");
    expect(res.fallbackUsed).toBe(true);
  });

  it("builds minimal-scope Gmail OAuth 2.0 URLs, verifies signed state, and encrypts exchanged tokens", async () => {
    process.env.GOOGLE_CLIENT_ID = "mock-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "mock-client-secret";

    const authUrl = buildGmailAuthorizationUrl({
      userId: "user-uuid-123",
      originOverride: "https://jobhunterai-five.vercel.app",
    });
    expect(authUrl).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(authUrl).toContain("gmail.send");
    expect(authUrl).not.toContain("gmail.readonly");

    const parsedState = new URL(authUrl).searchParams.get("state")!;
    expect(verifyGmailOAuthState(parsedState, "user-uuid-123")).toBe(true);
    expect(verifyGmailOAuthState(parsedState, "different-user")).toBe(false);

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "ya29.mock_access_token",
            refresh_token: "1//mock_refresh_token",
            expires_in: 3600,
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ email: "candidate@gmail.com" }), {
          status: 200,
        })
      );

    const exchanged = await exchangeGmailCodeAndPersist({
      userId: "user-uuid-123",
      code: "oauth_code_abc",
      originOverride: "https://jobhunterai-five.vercel.app",
    });
    expect(exchanged.emailAddress).toBe("candidate@gmail.com");
    expect(
      mockSupabaseState.upsertedConnection.encrypted_refresh_token.startsWith(
        "v1."
      )
    ).toBe(true);
    expect(
      mockSupabaseState.upsertedConnection.encrypted_refresh_token
    ).not.toContain("mock_refresh_token");
  });

  it("encodes CV + Cover Letter PDFs into RFC 2822 MIME and strictly blocks unapproved sends", async () => {
    const cvBuf = Buffer.from("%PDF-1.7 CV content", "utf8");
    const clBuf = Buffer.from("%PDF-1.7 Cover letter content", "utf8");

    const rawMime = buildGmailRawMimeMessage({
      from: "Youssef Benali <candidate@gmail.com>",
      to: "recrutement@company.ma",
      subject: "Candidature — Ingénieur Full-Stack",
      textBody: "Bonjour,\nVeuillez trouver mon dossier ci-joint.",
      attachments: [
        {
          filename: "Youssef_Benali_CV.pdf",
          mimeType: "application/pdf",
          content: cvBuf,
        },
        {
          filename: "Cover_Letter.pdf",
          mimeType: "application/pdf",
          content: clBuf,
        },
      ],
    });

    const decodedMime = Buffer.from(
      rawMime.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    expect(decodedMime).toContain('filename="Youssef_Benali_CV.pdf"');
    expect(decodedMime).toContain('filename="Cover_Letter.pdf"');

    // Unapproved application MUST be rejected immediately before touching email provider
    mockSupabaseState.documents = [
      {
        document_type: "cv",
        storage_bucket: "resumes",
        storage_path: "u/cv.pdf",
        content_sha256: "1".repeat(64),
        file_name: "cv.pdf",
      },
      {
        document_type: "cover_letter",
        storage_bucket: "application-documents",
        storage_path: "u/cl.pdf",
        content_sha256: "2".repeat(64),
        file_name: "cl.pdf",
      },
    ];
    mockSupabaseState.application = {
      id: "app-1",
      user_id: "user-1",
      approval_status: "awaiting_approval",
      approval_hash: null,
      recipient_email: "recrutement@company.ma",
      email_subject: "Subject",
      email_body: "Body",
    };

    await expect(
      sendApprovedApplicationEmail({
        userId: "user-1",
        applicationId: "app-1",
      })
    ).rejects.toThrow(/approval/i);

    // Already-sent application MUST be blocked against duplicate send
    const dummyHash = computeApprovalHash({
      recipientEmail: "recrutement@company.ma",
      subject: "Subject",
      body: "Body",
      cvStoragePath: "u/cv.pdf",
      cvSha256: "1".repeat(64),
      coverLetterStoragePath: "u/cl.pdf",
      coverLetterSha256: "2".repeat(64),
    });
    mockSupabaseState.application = {
      id: "app-1",
      user_id: "user-1",
      approval_status: "sent",
      approval_hash: dummyHash,
      recipient_email: "recrutement@company.ma",
      email_subject: "Subject",
      email_body: "Body",
    };

    await expect(
      sendApprovedApplicationEmail({
        userId: "user-1",
        applicationId: "app-1",
      })
    ).rejects.toThrow(/already|not 'approved'/i);
  });
});
