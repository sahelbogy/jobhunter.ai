-- ============================================================================
-- Migration: 20261022000002_role_grants_and_rls_hardening.sql
-- Purpose: Ensure Supabase PostgREST roles (`authenticated`, `service_role`)
-- hold required table privileges governed strictly by Row Level Security (RLS),
-- while explicitly revoking SELECT/INSERT/UPDATE on `email_connections` from
-- `anon` and `authenticated` so encrypted tokens are server-only.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.profiles,
  public.resumes,
  public.user_preferences,
  public.companies,
  public.jobs,
  public.job_matches,
  public.applications,
  public.application_documents,
  public.automation_settings,
  public.notifications
TO authenticated;

-- Read-only audit tables for authenticated owners (inserts performed by server)
GRANT SELECT ON
  public.email_logs,
  public.automation_runs,
  public.ai_generation_logs
TO authenticated;

-- Encrypted OAuth/SMTP credentials table: authenticated role may ONLY delete own row;
-- SELECT/INSERT/UPDATE are strictly restricted to server-side service_role!
REVOKE ALL ON public.email_connections FROM anon, authenticated;
GRANT DELETE ON public.email_connections TO authenticated;

-- Revoke any accidental public/anon access on user tables
REVOKE ALL ON
  public.profiles,
  public.resumes,
  public.user_preferences,
  public.companies,
  public.jobs,
  public.job_matches,
  public.applications,
  public.application_documents,
  public.email_connections,
  public.email_logs,
  public.automation_settings,
  public.automation_runs,
  public.ai_generation_logs,
  public.notifications
FROM anon;
