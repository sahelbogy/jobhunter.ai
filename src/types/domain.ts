import { z } from "zod";

export type SupportedLanguage = "fr" | "en";

export type AiProviderId = "groq" | "gemini" | "xai";

export type JobSourceId =
  | "adzuna"
  | "remotive"
  | "arbeitnow"
  | "smartrecruiters"
  | "greenhouse"
  | "lever"
  | "ashby";

export type ApprovalStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "sending"
  | "sent"
  | "failed"
  | "rejected";

export type TrackingStatus =
  | "draft"
  | "pending_approval"
  | "sent"
  | "applied_externally"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn";

export type CompanyApplicationMethod =
  | "published_vacancies"
  | "spontaneous_application"
  | "unverified_channel";

export interface LanguageProficiency {
  language: string;
  level: string;
}

export interface EducationItem {
  institution: string;
  degree: string;
  field?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  description?: string;
}

export interface WorkExperienceItem {
  company: string;
  title: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
  highlights: string[];
}

export interface CertificationItem {
  name: string;
  issuer?: string;
  date?: string;
  credentialUrl?: string;
}

export interface ProjectItem {
  name: string;
  role?: string;
  description: string;
  technologies: string[];
  url?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  professional_title: string;
  phone: string;
  location: string;
  summary: string;
  linkedin_url: string;
  portfolio_url: string;
  years_of_experience: number;
  technical_skills: string[];
  soft_skills: string[];
  technologies: string[];
  sectors: string[];
  languages: LanguageProficiency[];
  education: EducationItem[];
  work_experience: WorkExperienceItem[];
  certifications: CertificationItem[];
  projects: ProjectItem[];
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExtractedCvProfile {
  full_name: string;
  professional_title: string;
  email: string;
  phone: string;
  location: string;
  summary: string;
  years_of_experience: number;
  technical_skills: string[];
  soft_skills: string[];
  technologies: string[];
  sectors: string[];
  languages: LanguageProficiency[];
  education: EducationItem[];
  work_experience: WorkExperienceItem[];
  certifications: CertificationItem[];
  projects: ProjectItem[];
}

export const ExtractedCvProfileSchema = z.object({
  full_name: z.string().default(""),
  professional_title: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  location: z.string().default(""),
  summary: z.string().default(""),
  years_of_experience: z.number().min(0).max(60).default(0),
  technical_skills: z.array(z.string()).default([]),
  soft_skills: z.array(z.string()).default([]),
  technologies: z.array(z.string()).default([]),
  sectors: z.array(z.string()).default([]),
  languages: z
    .array(
      z.object({
        language: z.string(),
        level: z.string().default("Professional"),
      })
    )
    .default([]),
  education: z
    .array(
      z.object({
        institution: z.string(),
        degree: z.string(),
        field: z.string().optional().default(""),
        startDate: z.string().optional().default(""),
        endDate: z.string().optional().default(""),
        location: z.string().optional().default(""),
        description: z.string().optional().default(""),
      })
    )
    .default([]),
  work_experience: z
    .array(
      z.object({
        company: z.string(),
        title: z.string(),
        location: z.string().optional().default(""),
        startDate: z.string().optional().default(""),
        endDate: z.string().optional().default(""),
        current: z.boolean().optional().default(false),
        highlights: z.array(z.string()).default([]),
      })
    )
    .default([]),
  certifications: z
    .array(
      z.object({
        name: z.string(),
        issuer: z.string().optional().default(""),
        date: z.string().optional().default(""),
        credentialUrl: z.string().optional().default(""),
      })
    )
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().optional().default(""),
        description: z.string().default(""),
        technologies: z.array(z.string()).default([]),
        url: z.string().optional().default(""),
      })
    )
    .default([]),
});

export interface DiscoveredJobInput {
  external_id: string;
  source: JobSourceId;
  title: string;
  company_name: string;
  company_website?: string | null;
  company_careers_page?: string | null;
  company_ats_provider?: "smartrecruiters" | "greenhouse" | "lever" | "ashby" | null;
  company_ats_slug?: string | null;
  location: string;
  country_code?: string | null;
  is_remote: boolean;
  contract_type: string;
  sector: string;
  description: string;
  required_skills: string[];
  experience_requirements: string;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_text?: string | null;
  detected_language: SupportedLanguage;
  public_recruitment_email?: string | null;
  application_url: string;
  published_at?: string | null;
  application_deadline?: string | null;
  raw_metadata?: Record<string, unknown>;
}

export interface MatchScoreBreakdown {
  technical_skills: number;
  experience: number;
  education: number;
  languages: number;
  location: number;
  sector: number;
}

export interface JobMatchAnalysis {
  match_score: number;
  score_breakdown: MatchScoreBreakdown;
  matching_skills: string[];
  missing_skills: string[];
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  explanation: string;
  scoring_method: "deterministic" | "hybrid_ai";
  ai_provider?: string | null;
  ai_model?: string | null;
}

export interface GeneratedApplicationPackage {
  language: SupportedLanguage;
  email_subject: string;
  email_greeting: string;
  email_intro: string;
  email_experience_summary: string;
  email_motivation: string;
  email_closing: string;
  email_signature: string;
  email_body: string;
  cover_letter_subject: string;
  cover_letter_greeting: string;
  cover_letter_paragraphs: string[];
  cover_letter_closing: string;
  cover_letter_signature: string;
  cover_letter_text: string;
  ai_provider: string;
  ai_model: string;
  fallback_used: boolean;
}
