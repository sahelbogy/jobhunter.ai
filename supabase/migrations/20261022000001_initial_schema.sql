-- ============================================================================
-- AI JOB HUNTER — COMPLETE PRODUCTION POSTGRESQL SCHEMA & RLS POLICIES
-- Migration: 20261022000001_initial_schema.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. UTILITY TRIGGER FOR updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. PROFILES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT DEFAULT '',
  professional_title TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  location TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  linkedin_url TEXT DEFAULT '',
  portfolio_url TEXT DEFAULT '',
  years_of_experience NUMERIC(4,1) DEFAULT 0 CHECK (years_of_experience >= 0 AND years_of_experience <= 60),
  technical_skills TEXT[] NOT NULL DEFAULT '{}',
  soft_skills TEXT[] NOT NULL DEFAULT '{}',
  technologies TEXT[] NOT NULL DEFAULT '{}',
  sectors TEXT[] NOT NULL DEFAULT '{}',
  languages JSONB NOT NULL DEFAULT '[]'::jsonb,
  education JSONB NOT NULL DEFAULT '[]'::jsonb,
  work_experience JSONB NOT NULL DEFAULT '[]'::jsonb,
  certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
  projects JSONB NOT NULL DEFAULT '[]'::jsonb,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RESUMES (CVs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'resumes',
  storage_path TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  mime_type TEXT NOT NULL DEFAULT 'application/pdf' CHECK (mime_type = 'application/pdf'),
  file_sha256 TEXT NOT NULL,
  raw_text TEXT DEFAULT '',
  extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_language TEXT NOT NULL DEFAULT 'en' CHECK (detected_language IN ('fr', 'en', 'other')),
  parse_status TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending', 'parsed', 'analyzed', 'failed')),
  parse_error TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON public.resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_resumes_user_active ON public.resumes(user_id, is_active);

DROP TRIGGER IF EXISTS trg_resumes_updated_at ON public.resumes;
CREATE TRIGGER trg_resumes_updated_at
  BEFORE UPDATE ON public.resumes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. USER PREFERENCES (Search + AI Provider Management)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  target_titles TEXT[] NOT NULL DEFAULT '{}',
  preferred_sectors TEXT[] NOT NULL DEFAULT '{}',
  target_locations TEXT[] NOT NULL DEFAULT ARRAY['Morocco', 'France', 'Europe', 'Remote'],
  remote_preference TEXT NOT NULL DEFAULT 'any' CHECK (remote_preference IN ('any', 'remote_only', 'hybrid', 'onsite')),
  contract_types TEXT[] NOT NULL DEFAULT ARRAY['full_time', 'contract'],
  preferred_languages TEXT[] NOT NULL DEFAULT ARRAY['fr', 'en'],
  min_salary INTEGER CHECK (min_salary IS NULL OR min_salary >= 0),
  salary_currency TEXT NOT NULL DEFAULT 'EUR',
  experience_level TEXT NOT NULL DEFAULT 'any' CHECK (experience_level IN ('any', 'intern', 'junior', 'mid', 'senior', 'lead')),
  min_match_score INTEGER NOT NULL DEFAULT 60 CHECK (min_match_score >= 0 AND min_match_score <= 100),
  primary_ai_provider TEXT NOT NULL DEFAULT 'groq' CHECK (primary_ai_provider IN ('groq', 'gemini', 'xai')),
  primary_ai_model TEXT NOT NULL DEFAULT 'llama-3.3-70b-versatile',
  fallback_ai_provider TEXT CHECK (fallback_ai_provider IS NULL OR fallback_ai_provider IN ('groq', 'gemini', 'xai')),
  fallback_ai_model TEXT,
  allow_paid_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON public.user_preferences(user_id);

DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. COMPANIES (Company Discovery Engine)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  industry TEXT DEFAULT 'Technology',
  website TEXT,
  location TEXT DEFAULT '',
  country_code TEXT,
  careers_page TEXT,
  ats_provider TEXT CHECK (ats_provider IS NULL OR ats_provider IN ('smartrecruiters', 'greenhouse', 'lever', 'ashby', 'direct', 'aggregator')),
  ats_slug TEXT,
  public_recruitment_email TEXT,
  email_source_url TEXT,
  description TEXT DEFAULT '',
  application_method TEXT NOT NULL DEFAULT 'unverified_channel'
    CHECK (application_method IN ('published_vacancies', 'spontaneous_application', 'unverified_channel')),
  vacancies_count INTEGER NOT NULL DEFAULT 0 CHECK (vacancies_count >= 0),
  relevance_score INTEGER DEFAULT 0 CHECK (relevance_score >= 0 AND relevance_score <= 100),
  matching_sectors TEXT[] NOT NULL DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_companies_user_id ON public.companies(user_id);
CREATE INDEX IF NOT EXISTS idx_companies_method ON public.companies(user_id, application_method);

DROP TRIGGER IF EXISTS trg_companies_updated_at ON public.companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. JOBS (Smart Job Discovery Engine)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  dedup_hash TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('adzuna', 'remotive', 'arbeitnow', 'smartrecruiters', 'greenhouse', 'lever', 'ashby')),
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'Unspecified',
  country_code TEXT,
  is_remote BOOLEAN NOT NULL DEFAULT FALSE,
  contract_type TEXT DEFAULT 'full_time',
  sector TEXT DEFAULT 'Technology',
  description TEXT NOT NULL DEFAULT '',
  required_skills TEXT[] NOT NULL DEFAULT '{}',
  experience_requirements TEXT DEFAULT '',
  salary_min NUMERIC(12,2),
  salary_max NUMERIC(12,2),
  salary_currency TEXT,
  salary_text TEXT,
  detected_language TEXT NOT NULL DEFAULT 'en' CHECK (detected_language IN ('fr', 'en')),
  public_recruitment_email TEXT,
  application_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  application_deadline TIMESTAMPTZ,
  is_saved BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, dedup_hash)
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON public.jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON public.jobs(user_id, source);
CREATE INDEX IF NOT EXISTS idx_jobs_discovered_at ON public.jobs(user_id, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON public.jobs(company_id);

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON public.jobs;
CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 7. JOB MATCHES (AI Compatibility Scoring Engine)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  resume_id UUID REFERENCES public.resumes(id) ON DELETE SET NULL,
  match_score INTEGER NOT NULL CHECK (match_score >= 0 AND match_score <= 100),
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  matching_skills TEXT[] NOT NULL DEFAULT '{}',
  missing_skills TEXT[] NOT NULL DEFAULT '{}',
  strengths TEXT[] NOT NULL DEFAULT '{}',
  weaknesses TEXT[] NOT NULL DEFAULT '{}',
  recommendation TEXT NOT NULL DEFAULT '',
  explanation TEXT NOT NULL DEFAULT '',
  scoring_method TEXT NOT NULL DEFAULT 'deterministic' CHECK (scoring_method IN ('deterministic', 'hybrid_ai')),
  ai_provider TEXT,
  ai_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_job_matches_user_score ON public.job_matches(user_id, match_score DESC);
CREATE INDEX IF NOT EXISTS idx_job_matches_job_id ON public.job_matches(job_id);

DROP TRIGGER IF EXISTS trg_job_matches_updated_at ON public.job_matches;
CREATE TRIGGER trg_job_matches_updated_at
  BEFORE UPDATE ON public.job_matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 8. APPLICATIONS (Approval Workflow + Application Tracker)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  job_match_id UUID REFERENCES public.job_matches(id) ON DELETE SET NULL,
  resume_id UUID REFERENCES public.resumes(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  job_url TEXT NOT NULL DEFAULT '',
  application_source TEXT NOT NULL DEFAULT 'direct',
  match_score INTEGER CHECK (match_score IS NULL OR (match_score >= 0 AND match_score <= 100)),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('fr', 'en')),
  recipient_email TEXT,
  recipient_source TEXT NOT NULL DEFAULT 'none' CHECK (recipient_source IN ('none', 'published_job_contact', 'published_company_contact', 'user_verified_manual')),
  email_subject TEXT NOT NULL DEFAULT '',
  email_body TEXT NOT NULL DEFAULT '',
  cover_letter_text TEXT NOT NULL DEFAULT '',
  approval_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft', 'awaiting_approval', 'approved', 'sending', 'sent', 'failed', 'rejected')),
  tracking_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (tracking_status IN ('draft', 'pending_approval', 'sent', 'applied_externally', 'interview', 'offer', 'rejected', 'withdrawn')),
  approval_hash TEXT,
  approved_at TIMESTAMPTZ,
  approved_recipient TEXT,
  sent_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  email_delivery_result TEXT,
  follow_up_date DATE,
  notes TEXT NOT NULL DEFAULT '',
  ai_provider TEXT,
  ai_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_user_id ON public.applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_approval_status ON public.applications(user_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_applications_tracking_status ON public.applications(user_id, tracking_status);
CREATE INDEX IF NOT EXISTS idx_applications_follow_up ON public.applications(user_id, follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_unique_user_job ON public.applications(user_id, job_id) WHERE job_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_applications_updated_at ON public.applications;
CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 9. APPLICATION DOCUMENTS (CV + Generated Cover Letter PDFs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('cv', 'cover_letter')),
  file_name TEXT NOT NULL,
  storage_bucket TEXT NOT NULL CHECK (storage_bucket IN ('resumes', 'application-documents')),
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf' CHECK (mime_type = 'application/pdf'),
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  content_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_application_documents_app ON public.application_documents(application_id);
CREATE INDEX IF NOT EXISTS idx_application_documents_user ON public.application_documents(user_id);

DROP TRIGGER IF EXISTS trg_application_documents_updated_at ON public.application_documents;
CREATE TRIGGER trg_application_documents_updated_at
  BEFORE UPDATE ON public.application_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 10. EMAIL CONNECTIONS (Encrypted OAuth / SMTP Credentials — Server-Side Only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'smtp')),
  email_address TEXT NOT NULL,
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  daily_send_limit INTEGER NOT NULL DEFAULT 25 CHECK (daily_send_limit >= 1 AND daily_send_limit <= 100),
  sends_today INTEGER NOT NULL DEFAULT 0 CHECK (sends_today >= 0),
  quota_reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
  last_connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_connections_user_id ON public.email_connections(user_id);

DROP TRIGGER IF EXISTS trg_email_connections_updated_at ON public.email_connections;
CREATE TRIGGER trg_email_connections_updated_at
  BEFORE UPDATE ON public.email_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 11. EMAIL LOGS (Audit Trail + Idempotency + Duplicate-Send Prevention)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.applications(id) ON DELETE SET NULL,
  connection_id UUID REFERENCES public.email_connections(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  approval_hash_verified TEXT,
  attachments_meta JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'blocked_duplicate', 'blocked_unapproved', 'blocked_rate_limit')),
  provider TEXT NOT NULL DEFAULT 'gmail',
  provider_message_id TEXT,
  provider_thread_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_user_created ON public.email_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_application ON public.email_logs(application_id);

-- ----------------------------------------------------------------------------
-- 12. AUTOMATION SETTINGS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  schedule_cron TEXT NOT NULL DEFAULT '0 7 * * *',
  search_locations TEXT[] NOT NULL DEFAULT ARRAY['Morocco', 'France', 'Remote'],
  preferred_sectors TEXT[] NOT NULL DEFAULT '{}',
  search_keywords TEXT[] NOT NULL DEFAULT '{}',
  include_remote BOOLEAN NOT NULL DEFAULT TRUE,
  min_match_score INTEGER NOT NULL DEFAULT 70 CHECK (min_match_score >= 0 AND min_match_score <= 100),
  max_opportunities_per_run INTEGER NOT NULL DEFAULT 15 CHECK (max_opportunities_per_run >= 1 AND max_opportunities_per_run <= 50),
  auto_generate_drafts BOOLEAN NOT NULL DEFAULT TRUE,
  max_drafts_per_run INTEGER NOT NULL DEFAULT 3 CHECK (max_drafts_per_run >= 0 AND max_drafts_per_run <= 10),
  ai_provider TEXT NOT NULL DEFAULT 'groq' CHECK (ai_provider IN ('groq', 'gemini', 'xai')),
  fallback_ai_provider TEXT CHECK (fallback_ai_provider IS NULL OR fallback_ai_provider IN ('groq', 'gemini', 'xai')),
  email_language TEXT NOT NULL DEFAULT 'auto' CHECK (email_language IN ('auto', 'fr', 'en')),
  notify_in_app BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  active_lock_id TEXT,
  lock_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_settings_enabled ON public.automation_settings(is_enabled);

DROP TRIGGER IF EXISTS trg_automation_settings_updated_at ON public.automation_settings;
CREATE TRIGGER trg_automation_settings_updated_at
  BEFORE UPDATE ON public.automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 13. AUTOMATION RUNS (Execution History, Metrics, Retries & Operational Logs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed', 'skipped_locked')),
  sources_queried TEXT[] NOT NULL DEFAULT '{}',
  jobs_discovered INTEGER NOT NULL DEFAULT 0,
  jobs_inserted INTEGER NOT NULL DEFAULT 0,
  jobs_deduplicated INTEGER NOT NULL DEFAULT 0,
  jobs_matched INTEGER NOT NULL DEFAULT 0,
  drafts_generated INTEGER NOT NULL DEFAULT 0,
  notifications_sent INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  log_entries JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_user_started ON public.automation_runs(user_id, started_at DESC);

-- ----------------------------------------------------------------------------
-- 14. AI GENERATION LOGS (Observability & Cost/Quota Auditing)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('cv_analysis', 'job_matching', 'email_generation', 'cover_letter_generation', 'connection_test')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'rate_limited', 'fallback_triggered')),
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_generation_logs_user_created ON public.ai_generation_logs(user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 15. IN-APP NOTIFICATIONS (Automation & Follow-up Alerts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'system' CHECK (category IN ('system', 'automation', 'approval', 'email', 'followup')),
  link_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);

-- ----------------------------------------------------------------------------
-- 16. AUTO-BOOTSTRAP USER WORKSPACE ON AUTH SIGNUP
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.automation_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 17. ROW LEVEL SECURITY (RLS) — STRICT PER-USER ISOLATION
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Profiles policies
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;
CREATE POLICY "profiles_delete_own" ON public.profiles FOR DELETE USING (auth.uid() = id);

-- Resumes policies
DROP POLICY IF EXISTS "resumes_all_own" ON public.resumes;
CREATE POLICY "resumes_all_own" ON public.resumes FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- User preferences policies
DROP POLICY IF EXISTS "user_preferences_all_own" ON public.user_preferences;
CREATE POLICY "user_preferences_all_own" ON public.user_preferences FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Companies policies
DROP POLICY IF EXISTS "companies_all_own" ON public.companies;
CREATE POLICY "companies_all_own" ON public.companies FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Jobs policies
DROP POLICY IF EXISTS "jobs_all_own" ON public.jobs;
CREATE POLICY "jobs_all_own" ON public.jobs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Job matches policies
DROP POLICY IF EXISTS "job_matches_all_own" ON public.job_matches;
CREATE POLICY "job_matches_all_own" ON public.job_matches FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Applications policies
DROP POLICY IF EXISTS "applications_all_own" ON public.applications;
CREATE POLICY "applications_all_own" ON public.applications FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Application documents policies
DROP POLICY IF EXISTS "application_documents_all_own" ON public.application_documents;
CREATE POLICY "application_documents_all_own" ON public.application_documents FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Email connections: NEVER allow client direct access to encrypted tokens via anon client;
-- only server-side service role accesses token columns, while user can delete their connection if needed.
DROP POLICY IF EXISTS "email_connections_delete_own" ON public.email_connections;
CREATE POLICY "email_connections_delete_own" ON public.email_connections FOR DELETE USING (auth.uid() = user_id);

-- Email logs policies (read-only to owner; inserted by server)
DROP POLICY IF EXISTS "email_logs_select_own" ON public.email_logs;
CREATE POLICY "email_logs_select_own" ON public.email_logs FOR SELECT USING (auth.uid() = user_id);

-- Automation settings policies
DROP POLICY IF EXISTS "automation_settings_all_own" ON public.automation_settings;
CREATE POLICY "automation_settings_all_own" ON public.automation_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Automation runs policies
DROP POLICY IF EXISTS "automation_runs_select_own" ON public.automation_runs;
CREATE POLICY "automation_runs_select_own" ON public.automation_runs FOR SELECT USING (auth.uid() = user_id);

-- AI generation logs policies
DROP POLICY IF EXISTS "ai_generation_logs_select_own" ON public.ai_generation_logs;
CREATE POLICY "ai_generation_logs_select_own" ON public.ai_generation_logs FOR SELECT USING (auth.uid() = user_id);

-- Notifications policies
DROP POLICY IF EXISTS "notifications_all_own" ON public.notifications;
CREATE POLICY "notifications_all_own" ON public.notifications FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 18. PRIVATE SUPABASE STORAGE BUCKETS & STORAGE RLS POLICIES
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('resumes', 'resumes', FALSE, 10485760, ARRAY['application/pdf']),
  ('application-documents', 'application-documents', FALSE, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "resumes_storage_select_own" ON storage.objects;
CREATE POLICY "resumes_storage_select_own"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "resumes_storage_insert_own" ON storage.objects;
CREATE POLICY "resumes_storage_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "resumes_storage_delete_own" ON storage.objects;
CREATE POLICY "resumes_storage_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'resumes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "app_docs_storage_select_own" ON storage.objects;
CREATE POLICY "app_docs_storage_select_own"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'application-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "app_docs_storage_insert_own" ON storage.objects;
CREATE POLICY "app_docs_storage_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'application-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "app_docs_storage_delete_own" ON storage.objects;
CREATE POLICY "app_docs_storage_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'application-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
