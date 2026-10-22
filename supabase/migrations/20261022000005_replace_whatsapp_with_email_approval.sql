-- =============================================================================
-- Migration 0005: Remove WhatsApp Logic & Add Cryptographic Email Approval Loop
-- =============================================================================

-- 1. Drop obsolete WhatsApp approval table
DROP TABLE IF EXISTS public.whatsapp_approval_requests CASCADE;

-- 2. Replace WhatsApp columns on automation_settings with Email Approval settings
ALTER TABLE public.automation_settings
  DROP COLUMN IF EXISTS whatsapp_enabled,
  DROP COLUMN IF EXISTS whatsapp_phone_number,
  DROP COLUMN IF EXISTS auto_send_on_whatsapp_approval,
  ADD COLUMN IF NOT EXISTS email_approval_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_email_recipient TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS auto_send_on_email_approval BOOLEAN NOT NULL DEFAULT true;

-- 3. Replace WhatsApp columns on applications with Email Approval tracking
ALTER TABLE public.applications
  DROP COLUMN IF EXISTS whatsapp_notified_at,
  DROP COLUMN IF EXISTS whatsapp_message_id,
  ADD COLUMN IF NOT EXISTS approval_email_sent_at TIMESTAMPTZ;

-- 4. Create email_approval_requests table (stores only SHA-256 token_hash, never raw token)
CREATE TABLE IF NOT EXISTS public.email_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  approval_code TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  approval_hash TEXT NOT NULL,
  approver_email TEXT NOT NULL,
  email_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'invalidated')),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_email_approval_requests_user_created
  ON public.email_approval_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_approval_requests_token_hash
  ON public.email_approval_requests (token_hash);

ALTER TABLE public.email_approval_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own email approval requests" ON public.email_approval_requests;
CREATE POLICY "Users view own email approval requests"
  ON public.email_approval_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Grant SELECT on safe metadata columns to authenticated (never token_hash), full access to service_role
REVOKE ALL ON TABLE public.email_approval_requests FROM anon, authenticated;
GRANT SELECT (
  id,
  user_id,
  application_id,
  approval_code,
  approval_hash,
  approver_email,
  email_message_id,
  status,
  expires_at,
  responded_at,
  created_at
) ON TABLE public.email_approval_requests TO authenticated;
GRANT ALL ON TABLE public.email_approval_requests TO service_role;
