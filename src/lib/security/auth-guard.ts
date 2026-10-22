import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AuthGuardSuccess = {
  ok: true;
  user: User;
  supabase: SupabaseClient;
};

export type AuthGuardFailure = {
  ok: false;
  response: NextResponse;
};

export async function requireAuthenticatedUser(): Promise<
  AuthGuardSuccess | AuthGuardFailure
> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Unauthorized. Please log in to access your workspace." },
          { status: 401 }
        ),
      };
    }

    return { ok: true, user, supabase };
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            err instanceof Error
              ? `Authentication service unavailable: ${err.message}`
              : "Authentication verification failed.",
        },
        { status: 503 }
      ),
    };
  }
}
