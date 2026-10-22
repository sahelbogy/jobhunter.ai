import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;
  const { id } = await context.params;

  const { data: resume } = await supabase
    .from("resumes")
    .select("id, file_name, storage_bucket, storage_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!resume) {
    return NextResponse.json({ error: "CV not found." }, { status: 404 });
  }

  const admin = createAdminSupabaseClient();
  const { data: blob, error } = await admin.storage
    .from(resume.storage_bucket)
    .download(resume.storage_path);

  if (error || !blob) {
    return NextResponse.json(
      { error: "Unable to download CV file from storage." },
      { status: 404 }
    );
  }

  const bytes = Buffer.from(await blob.arrayBuffer());
  const safeName = resume.file_name.replace(/["\\\r\n]/g, "_");

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
