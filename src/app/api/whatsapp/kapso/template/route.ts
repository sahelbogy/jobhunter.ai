import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import {
  createKapsoUtilityTemplate,
  listApprovedKapsoTemplates,
  resolveKapsoPhoneNumber,
} from "@/lib/whatsapp/kapso";

const BodySchema = z.object({
  language: z.enum(["fr", "en"]).optional().default("fr"),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;

  try {
    const body = BodySchema.parse(await request.json().catch(() => ({})));
    const created = await createKapsoUtilityTemplate({
      language: body.language,
    });
    const connected = await resolveKapsoPhoneNumber({
      enrichFromPlatform: true,
    }).catch(() => null);
    const approvedTemplates = await listApprovedKapsoTemplates(
      connected?.businessAccountId
    );

    return NextResponse.json({
      ok: true,
      template: created,
      approvedTemplates,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not submit Meta Utility template.",
      },
      { status: 400 }
    );
  }
}
