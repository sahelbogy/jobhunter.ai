import { NextResponse, type NextRequest } from "next/server";
import { ExtractedCvProfileSchema } from "@/types/domain";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;
  const { id } = await context.params;

  const { data: resume } = await supabase
    .from("resumes")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!resume) {
    return NextResponse.json({ error: "CV not found." }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const candidateData = ExtractedCvProfileSchema.parse(
      body.extracted_data ?? resume.extracted_data ?? {}
    );

    // Persist reviewed extracted_data on the resume AND sync into profiles
    await supabase
      .from("resumes")
      .update({ is_active: false })
      .eq("user_id", user.id);

    await supabase
      .from("resumes")
      .update({
        extracted_data: candidateData,
        is_active: true,
      })
      .eq("id", resume.id)
      .eq("user_id", user.id);

    const { data: updatedProfile, error: profErr } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        email: candidateData.email || user.email || "",
        full_name: candidateData.full_name,
        professional_title: candidateData.professional_title,
        phone: candidateData.phone,
        location: candidateData.location,
        summary: candidateData.summary,
        years_of_experience: candidateData.years_of_experience,
        technical_skills: candidateData.technical_skills,
        soft_skills: candidateData.soft_skills,
        technologies: candidateData.technologies,
        sectors: candidateData.sectors,
        languages: candidateData.languages,
        education: candidateData.education,
        work_experience: candidateData.work_experience,
        certifications: candidateData.certifications,
        projects: candidateData.projects,
        onboarding_completed: true,
      })
      .select("*")
      .single();

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    return NextResponse.json({ profile: updatedProfile });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to apply CV data to profile.",
      },
      { status: 400 }
    );
  }
}
