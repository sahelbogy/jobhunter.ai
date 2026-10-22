import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { validateRecipientEmail } from "@/lib/security/sanitize";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { dispatchApplicationToEmailForApproval } from "@/lib/email/approval-loop";
import { dispatchThroughUserEmailConnection } from "@/lib/email/transport";

const BodySchema = z.object({
  approverEmail: z.string().max(180).optional(),
  applicationId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    const body = BodySchema.parse(await request.json().catch(() => ({})));
    const adminSupabase = createAdminSupabaseClient();

    if (body.applicationId) {
      const dispatchRes = await dispatchApplicationToEmailForApproval({
        adminSupabase,
        userId: user.id,
        applicationId: body.applicationId,
        approverEmail: body.approverEmail?.trim() || null,
      });

      if (!dispatchRes.dispatched) {
        return NextResponse.json(
          {
            error:
              dispatchRes.reason ||
              "Impossible d'envoyer l'email de validation.",
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

    const [{ data: settings }, { data: conn }] = await Promise.all([
      supabase
        .from("automation_settings")
        .select("approval_email_recipient")
        .eq("user_id", user.id)
        .maybeSingle(),
      adminSupabase
        .from("email_connections")
        .select("email_address, is_active")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

    if (!conn?.is_active) {
      return NextResponse.json(
        {
          error:
            "Connectez d'abord votre boîte email (Gmail App Password gratuit ou OAuth) dans Email Center (/emails).",
        },
        { status: 400 }
      );
    }

    const targetRaw =
      body.approverEmail?.trim() ||
      settings?.approval_email_recipient?.trim() ||
      conn.email_address?.trim() ||
      user.email ||
      "";
    const check = validateRecipientEmail(targetRaw);
    if (!check.valid) {
      return NextResponse.json(
        { error: "Entrez une adresse email de validation valide." },
        { status: 400 }
      );
    }

    const sent = await dispatchThroughUserEmailConnection({
      userId: user.id,
      to: check.normalized,
      subject: "✅ AI Job Hunter — Validation par Email active !",
      textBody:
        "Votre boucle de validation par email AI Job Hunter est opérationnelle. Vos candidatures préparées (Email personnalisé + Lettre de Motivation PDF jointe) arriveront dans cette boîte avec les boutons Approuver & Envoyer / Refuser.",
    });

    return NextResponse.json({
      ok: true,
      mode: "connection_test",
      approverEmail: check.normalized,
      senderEmail: sent.senderEmail,
      messageId: sent.messageId,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Test d'envoi d'email de validation échoué.",
      },
      { status: 400 }
    );
  }
}
