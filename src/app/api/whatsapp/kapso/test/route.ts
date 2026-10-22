import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  buildKapsoWaMeLink,
  dispatchApplicationToWhatsAppForApproval,
  getKapsoConfigStatus,
  listApprovedKapsoTemplates,
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
  let approvedTemplates: Awaited<ReturnType<typeof listApprovedKapsoTemplates>> =
    [];

  if (kapso.configured) {
    connectedNumber = await resolveKapsoPhoneNumber({
      enrichFromPlatform: true,
    }).catch(() => null);
    if (connectedNumber?.businessAccountId) {
      approvedTemplates = await listApprovedKapsoTemplates(
        connectedNumber.businessAccountId
      );
    }
  }

  return NextResponse.json({
    kapso,
    connectedNumber,
    waMeLink: buildKapsoWaMeLink(
      connectedNumber?.displayPhoneNumber,
      "Bonjour"
    ),
    approvedTemplates,
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

    const [{ data: settings }, { data: profile }, connectedNumber] =
      await Promise.all([
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
        resolveKapsoPhoneNumber({ enrichFromPlatform: true }).catch(() => null),
      ]);

    const waMeLink = buildKapsoWaMeLink(
      connectedNumber?.displayPhoneNumber,
      "Bonjour"
    );

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
            waMeLink,
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        ok: true,
        mode: "application_approval",
        waMeLink,
        ...dispatchRes,
      });
    }

    if (body.messageType === "template") {
      if (!body.templateName || body.templateName === "hello_world") {
        return NextResponse.json(
          {
            error:
              "Meta blocks the `hello_world` template (#131058) on real dedicated WhatsApp Business numbers. Open a 24h session window or create a custom UTILITY template first.",
            waMeLink,
          },
          { status: 400 }
        );
      }

      const tplSent = await sendKapsoTemplateMessage({
        to: normalizedPhone,
        templateName: body.templateName,
        languageCode: body.languageCode || "fr",
      });

      return NextResponse.json({
        ok: true,
        mode: "template_message",
        deliveryKind: "template",
        phone: `+${normalizedPhone}`,
        senderPhoneNumberId:
          tplSent.phoneNumberId ?? connectedNumber?.phoneNumberId ?? null,
        senderDisplayPhone:
          tplSent.displayPhoneNumber ??
          connectedNumber?.displayPhoneNumber ??
          null,
        waMeLink,
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
        senderPhoneNumberId:
          testSent.phoneNumberId ?? connectedNumber?.phoneNumberId ?? null,
        senderDisplayPhone:
          testSent.displayPhoneNumber ??
          connectedNumber?.displayPhoneNumber ??
          null,
        waMeLink,
        messageId: testSent.messageId,
      });
    } catch (textErr) {
      const primaryReason =
        textErr instanceof Error ? textErr.message : String(textErr);

      if (body.messageType === "text") {
        return NextResponse.json(
          {
            error: primaryReason,
            requiresSessionWindow: true,
            waMeLink,
            connectedNumber,
          },
          { status: 409 }
        );
      }

      // Check if an APPROVED custom WABA template (never `hello_world`) exists on this dedicated number
      const approvedTemplates = await listApprovedKapsoTemplates(
        connectedNumber?.businessAccountId
      );
      const parameterlessTemplate = approvedTemplates.find(
        (t) => !t.hasParameters
      );

      if (parameterlessTemplate) {
        const tplFallback = await sendKapsoTemplateMessage({
          to: normalizedPhone,
          templateName: parameterlessTemplate.name,
          languageCode: parameterlessTemplate.language,
        });

        return NextResponse.json({
          ok: true,
          mode: "connection_test",
          deliveryKind: "approved_utility_template",
          templateUsed: parameterlessTemplate.name,
          phone: `+${normalizedPhone}`,
          senderPhoneNumberId:
            tplFallback.phoneNumberId ?? connectedNumber?.phoneNumberId ?? null,
          senderDisplayPhone:
            tplFallback.displayPhoneNumber ??
            connectedNumber?.displayPhoneNumber ??
            null,
          waMeLink,
          messageId: tplFallback.messageId,
          note: `Modèle approuvé « ${parameterlessTemplate.name} » envoyé ! Répondez « Bonjour » à ce message sur WhatsApp pour activer les boutons interactifs 24h.`,
        });
      }

      const senderLabel =
        connectedNumber?.displayPhoneNumber ||
        connectedNumber?.phoneNumberId ||
        "votre numéro Kapso";

      return NextResponse.json(
        {
          requiresSessionWindow: true,
          waMeLink,
          connectedNumber,
          upstreamReason: primaryReason,
          error: `Fenêtre WhatsApp 24h non ouverte entre +${normalizedPhone} et ${senderLabel}. Sur un vrai numéro WhatsApp Business dédié, Meta exige soit que vous envoyiez d'abord « Bonjour » au numéro Kapso (1 clic ci-dessous), soit un modèle Utility approuvé.`,
        },
        { status: 409 }
      );
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
