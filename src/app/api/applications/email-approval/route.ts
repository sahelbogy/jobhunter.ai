import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { escapeHtml } from "@/lib/security/sanitize";
import { getPublicEnv } from "@/lib/env";
import {
  executeEmailApprovalDecision,
  inspectPendingEmailApprovalToken,
} from "@/lib/email/approval-loop";

function renderHtmlPage(params: {
  title: string;
  badgeColor: string;
  badgeText: string;
  bodyHtml: string;
  statusCode?: number;
}) {
  const { appUrl } = getPublicEnv();
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(params.title)} — AI Job Hunter</title>
</head>
<body style="margin:0;padding:28px 16px;background:#0f172a;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:580px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:18px;padding:28px;box-shadow:0 20px 50px rgba(0,0,0,0.35);">
    <div style="display:inline-block;padding:5px 12px;border-radius:999px;background:${params.badgeColor};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">
      ${escapeHtml(params.badgeText)}
    </div>
    <h1 style="margin:14px 0 12px 0;font-size:21px;line-height:1.35;">${escapeHtml(params.title)}</h1>
    ${params.bodyHtml}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #334155;display:flex;gap:16px;flex-wrap:wrap;font-size:13px;">
      <a href="${escapeHtml(appUrl)}/tracker" style="color:#60a5fa;text-decoration:none;font-weight:600;">Ouvrir Application Tracker &rarr;</a>
      <a href="${escapeHtml(appUrl)}/approvals" style="color:#94a3b8;text-decoration:none;">Approval Queue</a>
    </div>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: params.statusCode ?? 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Anti-scanner confirmation screen: GET never mutates state or sends emails
 * (protects against email link prefetchers). Human clicks the POST form button to execute.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token")?.trim() || "";
  const action =
    searchParams.get("action") === "reject" ? "reject" : "approve";

  const adminSupabase = createAdminSupabaseClient();
  const inspected = await inspectPendingEmailApprovalToken({
    adminSupabase,
    signedToken: token,
  });

  if (!inspected.valid || !inspected.application || !inspected.requestRow) {
    return renderHtmlPage({
      title: "Lien de validation indisponible",
      badgeColor: "#dc2626",
      badgeText: "Expiré ou déjà traité",
      bodyHtml: `<p style="color:#cbd5e1;font-size:14.5px;line-height:1.6;">${escapeHtml(
        inspected.reason || "Ce lien n'est plus actif."
      )}</p>`,
      statusCode: 400,
    });
  }

  const app = inspected.application;
  const reqRow = inspected.requestRow;
  const isApprove = action === "approve";
  const dest = app.recipient_email
    ? app.recipient_email
    : `Portail officiel (${app.job_url || "sans email direct"})`;

  return renderHtmlPage({
    title: isApprove
      ? `Confirmer l'envoi : ${app.job_title} — ${app.company_name}`
      : `Refuser la candidature : ${app.job_title} — ${app.company_name}`,
    badgeColor: isApprove ? "#2563eb" : "#dc2626",
    badgeText: `Code #${reqRow.approval_code}`,
    bodyHtml: `
      <div style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:14px;font-size:13.5px;line-height:1.6;color:#e2e8f0;margin-bottom:18px;">
        <div><strong>Entreprise :</strong> ${escapeHtml(app.company_name)} (${escapeHtml(app.location || "N/A")})</div>
        <div><strong>Destinataire :</strong> ${escapeHtml(dest)}</div>
        <div><strong>Objet :</strong> ${escapeHtml(app.email_subject || "")}</div>
      </div>
      <form method="POST" action="/api/applications/email-approval">
        <input type="hidden" name="token" value="${escapeHtml(token)}" />
        <input type="hidden" name="action" value="${escapeHtml(action)}" />
        <button type="submit" style="width:100%;cursor:pointer;border:none;border-radius:12px;padding:14px 20px;font-size:15px;font-weight:700;color:#ffffff;background:${
          isApprove ? "#16a34a" : "#dc2626"
        };">
          ${
            isApprove
              ? "✅ Confirmer &amp; Envoyer la Candidature Maintenant"
              : "🛑 Confirmer le Refus (Aucun Email Envoyé)"
          }
        </button>
      </form>
    `,
  });
}

export async function POST(request: NextRequest) {
  let token = "";
  let action: "approve" | "reject" = "approve";
  let wantsJson = false;

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    wantsJson = true;
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      any
    >;
    token = String(body.token || "").trim();
    action = body.action === "reject" ? "reject" : "approve";
  } else {
    const formData = await request.formData();
    token = String(formData.get("token") || "").trim();
    action = formData.get("action") === "reject" ? "reject" : "approve";
  }

  const adminSupabase = createAdminSupabaseClient();
  const outcome = await executeEmailApprovalDecision({
    adminSupabase,
    signedToken: token,
    decision: action,
  });

  if (wantsJson) {
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 400 });
  }

  const portalCta =
    outcome.portalUrl && outcome.status === "approved_portal_ready"
      ? `<p style="margin-top:16px;"><a href="${escapeHtml(
          outcome.portalUrl
        )}" target="_blank" rel="noreferrer" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">Ouvrir le Portail Officiel de l'Offre &rarr;</a></p>`
      : "";

  return renderHtmlPage({
    title: outcome.ok
      ? outcome.status === "rejected"
        ? "Candidature refusée"
        : "Candidature validée !"
      : "Action bloquée",
    badgeColor: outcome.ok
      ? outcome.status === "rejected"
        ? "#64748b"
        : "#16a34a"
      : "#dc2626",
    badgeText: outcome.status,
    bodyHtml: `<p style="color:#e2e8f0;font-size:14.5px;line-height:1.65;">${escapeHtml(
      outcome.message
    )}</p>${portalCta}`,
    statusCode: outcome.ok ? 200 : 400,
  });
}
