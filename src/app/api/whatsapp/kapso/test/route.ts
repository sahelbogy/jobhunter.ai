import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  dispatchApplicationToWhatsAppForApproval,
  getKapsoConfigStatus,
  normalizeWhatsAppPhone,
  sendKapsoTextMessage,
} from "@/lib/whatsapp/kapso";

const BodySchema = z.object({
  phone: z.string().max(30).optional(),
  applicationId: z.string().uuid().optional(),
});

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    kapso: getKapsoConfigStatus(),
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
            "Kapso WhatsApp requires KAPSO_API_KEY and KAPSO_PHONE_NUMBER_ID in your server environment variables.",
          kapso: kapsoStatus,
        },
        { status: 400 }
      );
    }

    const { data: settings } = await supabase
      .from("automation_settings")
      .select("whatsapp_phone_number")
      .eq("user_id", user.id)
      .maybeSingle();

    const rawPhone = body.phone?.trim() || settings?.whatsapp_phone_number || "";
    const normalizedPhone = normalizeWhatsAppPhone(rawPhone);

    if (!normalizedPhone) {
      return NextResponse.json(
        {
          error:
            "Enter a valid WhatsApp phone number in international format (e.g. +212612345678).",
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
          { error: dispatchRes.reason || "Could not dispatch WhatsApp approval." },
          { status: 400 }
        );
      }

      return NextResponse.json({
        ok: true,
        mode: "application_approval",
        ...dispatchRes,
      });
    }

    const testSent = await sendKapsoTextMessage({
      to: normalizedPhone,
      body: `✅ *AI Job Hunter — Connexion Kapso WhatsApp active !*\nVos candidatures préparées (message personnalisé + lettre de motivation PDF) vous seront envoyées ici avec les boutons *Approuver & Envoyer* / *Refuser*.`,
    });

    return NextResponse.json({
      ok: true,
      mode: "connection_test",
      phone: `+${normalizedPhone}`,
      messageId: testSent.messageId,
    });
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
