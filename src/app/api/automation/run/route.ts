import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { executeAutomationRunForUser } from "@/lib/automation/runner";

export async function POST() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const rl = checkRateLimit(`automation_run:${user.id}`, 5, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Automation manual trigger limit reached. Retry in ${rl.retryAfterSeconds}s.`,
      },
      { status: 429 }
    );
  }

  try {
    const admin = createAdminSupabaseClient();
    const summary = await executeAutomationRunForUser({
      adminSupabase: admin,
      userId: user.id,
      triggerType: "manual",
    });

    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Manual automation run failed.",
      },
      { status: 500 }
    );
  }
}
