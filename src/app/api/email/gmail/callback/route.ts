import { NextResponse, type NextRequest } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import {
  exchangeGmailCodeAndPersist,
  verifyGmailOAuthState,
} from "@/lib/email/gmail-oauth";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const baseAppUrl = (process.env.APP_URL?.trim() || origin).replace(/\/+$/, "");

  if (oauthError) {
    return NextResponse.redirect(
      `${baseAppUrl}/emails?error=${encodeURIComponent(
        `Google authorization canceled or denied (${oauthError}).`
      )}`
    );
  }

  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return NextResponse.redirect(
      `${baseAppUrl}/login?redirectTo=${encodeURIComponent("/emails")}`
    );
  }

  if (!code || !state || !verifyGmailOAuthState(state, auth.user.id)) {
    return NextResponse.redirect(
      `${baseAppUrl}/emails?error=${encodeURIComponent(
        "Invalid or expired OAuth state parameter. Please try connecting again."
      )}`
    );
  }

  try {
    const { emailAddress } = await exchangeGmailCodeAndPersist({
      userId: auth.user.id,
      code,
      originOverride: baseAppUrl,
    });

    return NextResponse.redirect(
      `${baseAppUrl}/emails?connected=${encodeURIComponent(emailAddress)}`
    );
  } catch (err) {
    return NextResponse.redirect(
      `${baseAppUrl}/emails?error=${encodeURIComponent(
        err instanceof Error ? err.message : "Gmail connection failed."
      )}`
    );
  }
}
