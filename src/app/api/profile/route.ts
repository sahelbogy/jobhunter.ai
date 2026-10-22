import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/lib/security/auth-guard";

const ProfileUpdateSchema = z.object({
  full_name: z.string().max(120).optional(),
  professional_title: z.string().max(140).optional(),
  phone: z.string().max(40).optional(),
  location: z.string().max(120).optional(),
  summary: z.string().max(3000).optional(),
  linkedin_url: z.string().max(300).optional(),
  portfolio_url: z.string().max(300).optional(),
  years_of_experience: z.number().min(0).max(60).optional(),
  technical_skills: z.array(z.string().max(80)).max(60).optional(),
  soft_skills: z.array(z.string().max(80)).max(40).optional(),
  technologies: z.array(z.string().max(80)).max(60).optional(),
  sectors: z.array(z.string().max(80)).max(25).optional(),
  languages: z
    .array(z.object({ language: z.string().max(60), level: z.string().max(60) }))
    .max(15)
    .optional(),
  education: z
    .array(
      z.object({
        institution: z.string().max(160),
        degree: z.string().max(160),
        field: z.string().max(160).optional().default(""),
        startDate: z.string().max(40).optional().default(""),
        endDate: z.string().max(40).optional().default(""),
        location: z.string().max(120).optional().default(""),
        description: z.string().max(1000).optional().default(""),
      })
    )
    .max(15)
    .optional(),
  work_experience: z
    .array(
      z.object({
        company: z.string().max(160),
        title: z.string().max(160),
        location: z.string().max(120).optional().default(""),
        startDate: z.string().max(40).optional().default(""),
        endDate: z.string().max(40).optional().default(""),
        current: z.boolean().optional().default(false),
        highlights: z.array(z.string().max(500)).max(15).default([]),
      })
    )
    .max(20)
    .optional(),
  certifications: z
    .array(
      z.object({
        name: z.string().max(160),
        issuer: z.string().max(160).optional().default(""),
        date: z.string().max(40).optional().default(""),
        credentialUrl: z.string().max(300).optional().default(""),
      })
    )
    .max(20)
    .optional(),
  projects: z
    .array(
      z.object({
        name: z.string().max(160),
        role: z.string().max(120).optional().default(""),
        description: z.string().max(1200).default(""),
        technologies: z.array(z.string().max(60)).max(20).default([]),
        url: z.string().max(300).optional().default(""),
      })
    )
    .max(20)
    .optional(),
  onboarding_completed: z.boolean().optional(),
  preferences: z
    .object({
      target_titles: z.array(z.string().max(100)).max(20).optional(),
      preferred_sectors: z.array(z.string().max(100)).max(20).optional(),
      target_locations: z.array(z.string().max(100)).max(20).optional(),
      remote_preference: z
        .enum(["any", "remote_only", "hybrid", "onsite"])
        .optional(),
      contract_types: z.array(z.string().max(40)).max(10).optional(),
      preferred_languages: z.array(z.string().max(10)).max(5).optional(),
      min_salary: z.number().min(0).nullable().optional(),
      salary_currency: z.string().max(10).optional(),
      experience_level: z
        .enum(["any", "intern", "junior", "mid", "senior", "lead"])
        .optional(),
      min_match_score: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    const { data: created } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        email: user.email ?? "",
        full_name: (user.user_metadata?.full_name as string) ?? "",
      })
      .select("*")
      .single();
    profile = created;
  }

  let { data: preferences } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!preferences) {
    const { data: createdPrefs } = await supabase
      .from("user_preferences")
      .upsert({ user_id: user.id }, { onConflict: "user_id" })
      .select("*")
      .single();
    preferences = createdPrefs;
  }

  return NextResponse.json({ profile, preferences });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  try {
    const body = await request.json();
    const parsed = ProfileUpdateSchema.parse(body);
    const { preferences, ...profileFields } = parsed;

    const { data: updatedProfile, error: profErr } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        email: user.email ?? "",
        ...profileFields,
        onboarding_completed: true,
      })
      .select("*")
      .single();

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    let updatedPrefs = null;
    if (preferences) {
      const { data, error: prefErr } = await supabase
        .from("user_preferences")
        .upsert(
          {
            user_id: user.id,
            ...preferences,
          },
          { onConflict: "user_id" }
        )
        .select("*")
        .single();
      if (prefErr) {
        return NextResponse.json({ error: prefErr.message }, { status: 400 });
      }
      updatedPrefs = data;
    }

    return NextResponse.json({
      profile: updatedProfile,
      preferences: updatedPrefs,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Invalid profile update payload.",
      },
      { status: 400 }
    );
  }
}
