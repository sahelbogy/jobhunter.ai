import { NextResponse, type NextRequest } from "next/server";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { validatePdfBuffer } from "@/lib/security/sanitize";
import {
  analyzeCvWithAi,
  extractPdfTextFromBuffer,
} from "@/lib/cv/pdf-extractor";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { AiProviderId } from "@/types/domain";

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { data: resumes, error } = await supabase
    .from("resumes")
    .select(
      "id, file_name, storage_path, file_size, mime_type, extracted_data, detected_language, parse_status, parse_error, is_active, created_at, updated_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ resumes: resumes ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const rl = checkRateLimit(`cv_upload:${user.id}`, 8, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Rate limit reached for CV uploads. Retry in ${rl.retryAfterSeconds}s.`,
      },
      { status: 429 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Please attach a PDF file under the 'file' field." },
        { status: 400 }
      );
    }

    const uploadedBytes = new Uint8Array(await file.arrayBuffer());
    const buffer = Buffer.allocUnsafe(uploadedBytes.byteLength);
    buffer.set(uploadedBytes);
    const fileByteLength = buffer.byteLength;

    const validation = validatePdfBuffer(buffer, file.name, file.type);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // 1. Extract text safely from PDF (uses cloned buffer internally so `buffer` stays intact)
    const extraction = await extractPdfTextFromBuffer(buffer);

    // Defensive check that `buffer` was never detached and remains non-empty
    if (buffer.byteLength !== fileByteLength || fileByteLength <= 0) {
      return NextResponse.json(
        { error: "PDF byte stream became invalid during processing. Please retry." },
        { status: 500 }
      );
    }

    // 2. Upload intact PDF bytes to private Supabase Storage bucket `resumes/{user_id}/...`
    const safeName = file.name
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 80);
    const storagePath = `${user.id}/${Date.now()}-${safeName}`;

    const admin = createAdminSupabaseClient();
    const { error: uploadError } = await admin.storage
      .from("resumes")
      .upload(storagePath, new Uint8Array(buffer), {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // 3. Load user's AI provider preferences
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // 4. Analyze CV with AI (or deterministic zero-hallucination fallback if AI key unconfigured)
    const analysis = await analyzeCvWithAi({
      rawText: extraction.rawText,
      routing: {
        primaryProvider: (prefs?.primary_ai_provider ?? "groq") as AiProviderId,
        primaryModel: prefs?.primary_ai_model ?? null,
        fallbackProvider: (prefs?.fallback_ai_provider ??
          null) as AiProviderId | null,
        fallbackModel: prefs?.fallback_ai_model ?? null,
        allowPaidFallback: Boolean(prefs?.allow_paid_fallback),
        userId: user.id,
      },
      onLog: async (entry) => {
        await admin.from("ai_generation_logs").insert({
          user_id: user.id,
          ...entry,
        });
      },
    });

    // Deactivate prior active resumes before activating the new one
    await supabase
      .from("resumes")
      .update({ is_active: false })
      .eq("user_id", user.id);

    const { data: resumeRecord, error: insertError } = await supabase
      .from("resumes")
      .insert({
        user_id: user.id,
        file_name: file.name,
        storage_bucket: "resumes",
        storage_path: storagePath,
        file_size: fileByteLength,
        mime_type: "application/pdf",
        file_sha256: validation.sha256,
        raw_text: extraction.rawText,
        extracted_data: analysis.profile,
        detected_language: extraction.detectedLanguage,
        parse_status: "analyzed",
        is_active: true,
      })
      .select("*")
      .single();

    if (insertError) {
      await admin.storage.from("resumes").remove([storagePath]).catch(() => {});
      return NextResponse.json(
        { error: `Failed to save CV record: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      resume: resumeRecord,
      analysisMethod: analysis.method,
      provider: analysis.provider ?? null,
      model: analysis.model ?? null,
      warning: analysis.warning ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "CV upload and extraction failed.",
      },
      { status: 422 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const { searchParams } = new URL(request.url);
  const resumeId = searchParams.get("id");
  if (!resumeId) {
    return NextResponse.json(
      { error: "Missing resume id parameter." },
      { status: 400 }
    );
  }

  const { data: resume } = await supabase
    .from("resumes")
    .select("id, storage_bucket, storage_path")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!resume) {
    return NextResponse.json({ error: "CV not found." }, { status: 404 });
  }

  const admin = createAdminSupabaseClient();
  await admin.storage
    .from(resume.storage_bucket)
    .remove([resume.storage_path])
    .catch(() => {});

  const { error } = await supabase
    .from("resumes")
    .delete()
    .eq("id", resume.id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
