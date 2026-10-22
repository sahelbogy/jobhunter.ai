import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const [
    { data: profile },
    { data: preferences },
    { data: resumes },
    { data: jobs },
    { data: applications },
    { data: emailLogs },
    { data: automationSettings },
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("resumes")
      .select("id, file_name, detected_language, extracted_data, created_at")
      .eq("user_id", user.id),
    supabase.from("jobs").select("*").eq("user_id", user.id),
    supabase.from("applications").select("*").eq("user_id", user.id),
    supabase.from("email_logs").select("*").eq("user_id", user.id),
    supabase
      .from("automation_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return new NextResponse(
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        user: { id: user.id, email: user.email },
        profile,
        preferences,
        resumes,
        jobs,
        applications,
        emailLogs,
        automationSettings,
      },
      null,
      2
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="ai-job-hunter-data-export-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`,
      },
    }
  );
}

export async function DELETE() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    const admin = createAdminSupabaseClient();

    // 1. Delete all private storage files owned by the user
    const [{ data: resumes }, { data: appDocs }] = await Promise.all([
      supabase
        .from("resumes")
        .select("storage_path")
        .eq("user_id", user.id),
      supabase
        .from("application_documents")
        .select("storage_bucket, storage_path")
        .eq("user_id", user.id),
    ]);

    const resumePaths = (resumes ?? []).map((r) => r.storage_path);
    if (resumePaths.length > 0) {
      await admin.storage.from("resumes").remove(resumePaths).catch(() => {});
    }

    const appDocPaths = (appDocs ?? [])
      .filter((d) => d.storage_bucket === "application-documents")
      .map((d) => d.storage_path);
    if (appDocPaths.length > 0) {
      await admin.storage
        .from("application-documents")
        .remove(appDocPaths)
        .catch(() => {});
    }

    // 2. Delete auth.users record (ON DELETE CASCADE removes all 14 user tables cleanly)
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Account deletion failed.",
      },
      { status: 500 }
    );
  }
}
