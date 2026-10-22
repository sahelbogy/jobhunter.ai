import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  extractKapsoInboundMessages,
  processKapsoInboundDecision,
  verifyKapsoWebhookSignature,
} from "@/lib/whatsapp/kapso";

/**
 * Supports optional Meta / Kapso webhook challenge verification on GET.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const expectedSecret = process.env.KAPSO_WEBHOOK_SECRET?.trim();

  if (mode === "subscribe" && challenge) {
    if (!expectedSecret || token !== expectedSecret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json({
    ok: true,
    webhook: "kapso_whatsapp_approval",
    signatureRequired: true,
  });
}

/**
 * Receives inbound WhatsApp messages from Kapso (`whatsapp.message.received`).
 * Enforces mandatory HMAC-SHA256 `X-Webhook-Signature` over exact raw request bytes.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.KAPSO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "KAPSO_WEBHOOK_SECRET is not configured on the server; refusing unsigned webhook.",
      },
      { status: 503 }
    );
  }

  const rawArrayBuffer = await request.arrayBuffer();
  const rawBuffer = Buffer.from(rawArrayBuffer);
  const signature = request.headers.get("x-webhook-signature");

  if (!verifyKapsoWebhookSignature(rawBuffer, signature, secret)) {
    return NextResponse.json(
      { error: "Invalid X-Webhook-Signature." },
      { status: 401 }
    );
  }

  const eventHeader = request.headers.get("x-webhook-event") || "";
  if (eventHeader && eventHeader !== "whatsapp.message.received") {
    return NextResponse.json({ ok: true, ignoredEvent: eventHeader });
  }

  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() || null;

  let payload: unknown;
  try {
    payload = JSON.parse(rawBuffer.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const adminSupabase = createAdminSupabaseClient();

  if (idempotencyKey) {
    const { data: dupRow } = await adminSupabase
      .from("whatsapp_approval_requests")
      .select("id")
      .eq("webhook_idempotency_key", idempotencyKey)
      .limit(1)
      .maybeSingle();

    if (dupRow) {
      return NextResponse.json({
        ok: true,
        deduplicated: true,
        idempotencyKey,
      });
    }
  }

  const inboundMessages = extractKapsoInboundMessages(payload);
  const outcomes = [];

  for (const inbound of inboundMessages) {
    const res = await processKapsoInboundDecision({
      adminSupabase,
      inbound,
      webhookIdempotencyKey: idempotencyKey,
    });
    outcomes.push(res);
  }

  return NextResponse.json({
    ok: true,
    processedCount: outcomes.length,
    outcomes,
  });
}
