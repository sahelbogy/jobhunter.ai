import { NextResponse, type NextRequest } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  return NextResponse.json({ notifications: notifications ?? [] });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const body = await request.json().catch(() => ({}));
  if (body.markAllRead) {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);
  } else if (body.id) {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", String(body.id))
      .eq("user_id", user.id);
  }

  return NextResponse.json({ updated: true });
}
