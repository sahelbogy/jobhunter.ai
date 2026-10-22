import { NextResponse, type NextRequest } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { buildGmailAuthorizationUrl } from "@/lib/email/gmail-oauth";

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  try {
    const origin = new URL(request.url).origin;
    const authorizationUrl = buildGmailAuthorizationUrl({
      userId: user.id,
      originOverride: process.env.APP_URL?.trim() || origin,
    });
    return NextResponse.json({ url: authorizationUrl });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Unable to initiate Google OAuth.",
        requiresConfiguration: true,
      },
      { status: 422 }
    );
  }
}
