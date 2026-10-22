import { NextResponse, type NextRequest } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;
  const { id } = await context.params;

  const { data: updated, error } = await supabase
    .from("applications")
    .update({
      approval_status: "rejected",
      tracking_status: "withdrawn",
      approval_hash: null,
      approved_at: null,
      approved_recipient: null,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .neq("approval_status", "sent")
    .select("*, documents:application_documents(*)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ application: updated });
}
