import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  dispatchApplicationToWhatsAppForApproval,
  getKapsoConfigStatus,
  normalizeWhatsAppPhone,
  resolveKapsoPhoneNumber,
  sendKapsoTemplateMessage,
  sendKapsoTextMessage,
} from "@/lib/whatsapp/kapso";

const BodySchema = z.object({
  phone: z.string().max(30).optional(),
  applicationId: z.string().uuid().optional(),
  messageType: z.enum(["auto", "text", "template"]).optional().default("auto"),
  templateName: z.string().max(100).optional(),
  languageCode: z.string().max(20).optional(),
});

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  const kapso = getKapsoConfigStatus();
  let connectedNumber = null;

  if (kapso.configured) {
    connectedNumber = await resolveKapsoPhoneNumber().catch(() => null);
  }

  return NextResponse.json({
    kapso,
    connectedNumber,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    const body = BodySchema.parse(await request.json().catch(() => ({})));
    const kapsoStatus = getKapsoConfigStatus();

    if (!kapsoStatus.configured) {
      return NextResponse.json(
        {
          error:
            "Kapso WhatsApp requires KAPSO_API_KEY in your server environment variables.",
          kapso: kapsoStatus,
        },
        { status: 400 }
      );
    }

    const [{ data: settings }, { data: profile }] = await Promise.all([
      supabase
        .from("automation_settings")
        .select("whatsapp_phone_number")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("phone")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    const rawPhone =
      body.phone?.trim() ||
      settings?.whatsapp_phone_number?.trim() ||
      profile?.phone?.trim() ||
      "";
    const normalizedPhone = normalizeWhatsAppPhone(rawPhone);

    if (!normalizedPhone) {
      return NextResponse.json(
        {
          error:
            "Enter a valid WhatsApp phone number in international format (e.g. +212614192699).",
        },
        { status: 400 }
      );
    }

    const adminSupabase = createAdminSupabaseClient();

    if (body.applicationId) {
      const dispatchRes = await dispatchApplicationToWhatsAppForApproval({
        adminSupabase,
        userId: user.id,
        applicationId: body.applicationId,
        whatsappPhone: normalizedPhone,
      });

      if (!dispatchRes.dispatched) {
        return NextResponse.json(
          {
            error:
              dispatchRes.reason || "Could not dispatch WhatsApp approval.",
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        ok: true,
        mode: "application_approval",
        ...dispatchRes,
      });
    }

    if (body.messageType === "template") {
      const tplSent = await sendKapsoTemplateMessage({
        to: normalizedPhone,
        templateName: body.templateName || "hello_world",
        languageCode: body.languageCode || "en_US",
      });

      return NextResponse.json({
        ok: true,
        mode: "template_message",
        deliveryKind: "template",
        phone: `+${normalizedPhone}`,
        senderPhoneNumberId: tplSent.phoneNumberId ?? null,
        senderDisplayPhone: tplSent.displayPhoneNumber ?? null,
        messageId: tplSent.messageId,
      });
    }

    try {
      const testSent = await sendKapsoTextMessage({
        to: normalizedPhone,
        body: `✅ *AI Job Hunter — Connexion Kapso WhatsApp active !*\nVos candidatures préparées (message personnalisé + lettre de motivation PDF) vous seront envoyées ici avec les boutons *Approuver & Envoyer* / *Refuser*.`,
      });

      return NextResponse.json({
        ok: true,
        mode: "connection_test",
        deliveryKind: "text",
        phone: `+${normalizedPhone}`,
        senderPhoneNumberId: testSent.phoneNumberId ?? null,
        senderDisplayPhone: testSent.displayPhoneNumber ?? null,
        messageId: testSent.messageId,
      });
    } catch (textErr) {
      if (body.messageType === "text") {
        throw textErr;
      }
      // Outside an active 24h WhatsApp customer service window, automatically try `hello_world` template
      const tplFallback = await sendKapsoTemplateMessage({
        to: normalizedPhone,
        templateName: body.templateName || "hello_world",
        languageCode: body.languageCode || "en_US",
      });

      return NextResponse.json({
        ok: true,
        mode: "connection_test",
        deliveryKind: "template_fallback",
        phone: `+${normalizedPhone}`,
        senderPhoneNumberId: tplFallback.phoneNumberId ?? null,
        senderDisplayPhone: tplFallback.displayPhoneNumber ?? null,
        messageId: tplFallback.messageId,
        note: "Sent pre-approved template (`hello_world`) because no 24h inbound WhatsApp window was open yet. Reply 'Bonjour' to that message on WhatsApp to open the 24h interactive window.",
      });
    }
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Kapso WhatsApp test request failed.",
      },
      { status: 400 }
    );
  }
}
