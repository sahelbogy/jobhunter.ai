import { NextResponse, type NextRequest } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;
  const { id } = await context.params;

  const { searchParams } = new URL(request.url);
  const docType =
    searchParams.get("type") === "cv" ? "cv" : "cover_letter";

  const { data: doc } = await supabase
    .from("application_documents")
    .select("*")
    .eq("application_id", id)
    .eq("user_id", user.id)
    .eq("document_type", docType)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json(
      { error: `Document '${docType}' not found for this application.` },
      { status: 404 }
    );
  }

  const admin = createAdminSupabaseClient();
  const { data: blob, error } = await admin.storage
    .from(doc.storage_bucket)
    .download(doc.storage_path);

  if (error || !blob) {
    return NextResponse.json(
      { error: "Unable to download document from private storage." },
      { status: 404 }
    );
  }

  const bytes = Buffer.from(await blob.arrayBuffer());
  const safeName = doc.file_name.replace(/["\\\r\n]/g, "_");
  const download = searchParams.get("download") === "1";

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
