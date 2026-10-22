-- ============================================================================
-- Migration 000003: LinkedIn Import Source, Scheduled Batches & Kapso WhatsApp Approval Loop
-- ============================================================================

-- 1. Expand jobs.source check constraint to support compliant LinkedIn / external offer imports
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_source_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_source_check
  CHECK (source IN (
    'adzuna',
    'remotive',
    'arbeitnow',
    'smartrecruiters',
    'greenhouse',
    'lever',
    'ashby',
    'linkedin_import',
    'external_import'
  ));

-- 2. Add scheduling mode (daily vs specific date) and Kapso WhatsApp fields to automation_settings
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS schedule_mode TEXT NOT NULL DEFAULT 'daily'
    CHECK (schedule_mode IN ('daily', 'specific_date', 'manual_only')),
  ADD COLUMN IF NOT EXISTS scheduled_date DATE,
  ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS auto_send_on_whatsapp_approval BOOLEAN NOT NULL DEFAULT TRUE;

-- 3. Add scheduled batch date & WhatsApp tracking metadata to applications
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS scheduled_for_date DATE,
  ADD COLUMN IF NOT EXISTS whatsapp_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_applications_scheduled_date
  ON public.applications(user_id, scheduled_for_date)
  WHERE scheduled_for_date IS NOT NULL;

-- 4. Create whatsapp_approval_requests table for cryptographic Kapso WhatsApp approval binding
CREATE TABLE IF NOT EXISTS public.whatsapp_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  approval_code TEXT NOT NULL UNIQUE,
  approval_hash TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  kapso_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'approved_and_sent',
      'approved_queued',
      'approved_portal_only',
      'rejected',
      'expired',
      'failed'
    )),
  webhook_idempotency_key TEXT,
  error_message TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '72 hours'),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_approvals_user_created
  ON public.whatsapp_approval_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_approvals_phone_status
  ON public.whatsapp_approval_requests(recipient_phone, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_approvals_app_id
  ON public.whatsapp_approval_requests(application_id);

DROP TRIGGER IF EXISTS trg_whatsapp_approval_requests_updated_at ON public.whatsapp_approval_requests;
CREATE TRIGGER trg_whatsapp_approval_requests_updated_at
  BEFORE UPDATE ON public.whatsapp_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_approval_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_approval_requests_select_own" ON public.whatsapp_approval_requests;
CREATE POLICY "whatsapp_approval_requests_select_own"
  ON public.whatsapp_approval_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "whatsapp_approval_requests_delete_own" ON public.whatsapp_approval_requests;
CREATE POLICY "whatsapp_approval_requests_delete_own"
  ON public.whatsapp_approval_requests
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT, DELETE ON public.whatsapp_approval_requests TO authenticated;
GRANT ALL ON public.whatsapp_approval_requests TO service_role;
