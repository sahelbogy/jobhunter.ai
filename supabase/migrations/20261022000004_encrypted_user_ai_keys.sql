-- =============================================================================
-- Migration 0004: Server-Only Encrypted User AI Provider Keys
-- Allows users to store encrypted GROQ_API_KEY / GEMINI_API_KEY / XAI_API_KEY
-- directly from Account Settings without exposing secrets to browser clients.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_ai_secrets (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('groq', 'gemini', 'xai')),
  encrypted_api_key TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE public.user_ai_secrets ENABLE ROW LEVEL SECURITY;

-- Strict server-only vault: anon & authenticated roles cannot read ciphertext
REVOKE ALL ON TABLE public.user_ai_secrets FROM anon, authenticated;
GRANT ALL ON TABLE public.user_ai_secrets TO service_role;
