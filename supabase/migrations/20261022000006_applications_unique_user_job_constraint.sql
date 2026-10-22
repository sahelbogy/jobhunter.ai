-- =============================================================================
-- Migration 0006: Replace partial unique index on applications(user_id, job_id)
-- with a standard UNIQUE constraint (NULLS DISTINCT by default in PostgreSQL)
-- so PostgREST .upsert(..., { onConflict: "user_id,job_id" }) resolves cleanly
-- while still allowing multiple spontaneous applications where job_id IS NULL.
-- =============================================================================

DROP INDEX IF EXISTS public.idx_applications_unique_user_job;

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_user_id_job_id_key;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_user_id_job_id_key UNIQUE (user_id, job_id);
