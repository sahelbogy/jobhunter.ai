import { NextResponse, type NextRequest } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { sendApprovedApplicationEmail } from "@/lib/email/sender";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { id } = await context.params;

  const rl = checkRateLimit(`email_send:${user.id}`, 10, 5 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Email sending rate limit reached. Try again in ${rl.retryAfterSeconds}s.`,
      },
      { status: 429 }
    );
  }

  try {
    const result = await sendApprovedApplicationEmail({
      userId: user.id,
      applicationId: id,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to send application email.",
      },
      { status: 400 }
    );
  }
}
