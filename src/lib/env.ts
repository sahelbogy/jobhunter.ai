export interface PublicEnvConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  appUrl: string;
}

export interface ServerEnvStatus {
  supabaseConfigured: boolean;
  serviceRoleConfigured: boolean;
  groqConfigured: boolean;
  groqModel: string;
  geminiConfigured: boolean;
  geminiModel: string;
  xaiConfigured: boolean;
  xaiModel: string;
  adzunaConfigured: boolean;
  gmailOAuthConfigured: boolean;
  smtpConfigured: boolean;
  kapsoConfigured: boolean;
  kapsoWebhookSecretConfigured: boolean;
  cronSecretConfigured: boolean;
  tokenEncryptionConfigured: boolean;
}

export function getPublicEnv(): PublicEnvConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "";
  const appUrl =
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

  return {
    supabaseUrl,
    supabasePublishableKey,
    appUrl: appUrl.replace(/\/+$/, ""),
  };
}

export function getServerEnvStatus(): ServerEnvStatus {
  const pub = getPublicEnv();
  return {
    supabaseConfigured: Boolean(pub.supabaseUrl && pub.supabasePublishableKey),
    serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    groqConfigured: Boolean(process.env.GROQ_API_KEY?.trim()),
    groqModel: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite",
    xaiConfigured: Boolean(process.env.XAI_API_KEY?.trim()),
    xaiModel: process.env.XAI_MODEL?.trim() || "grok-4.7",
    adzunaConfigured: Boolean(
      process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim()
    ),
    gmailOAuthConfigured: Boolean(
      (process.env.GOOGLE_CLIENT_ID?.trim() ||
        process.env.GMAIL_CLIENT_ID?.trim()) &&
        (process.env.GOOGLE_CLIENT_SECRET?.trim() ||
          process.env.GMAIL_CLIENT_SECRET?.trim())
    ),
    smtpConfigured: Boolean(
      process.env.SMTP_HOST?.trim() &&
        process.env.SMTP_USER?.trim() &&
        process.env.SMTP_PASS?.trim()
    ),
    kapsoConfigured: Boolean(
      process.env.KAPSO_API_KEY?.trim() &&
        process.env.KAPSO_PHONE_NUMBER_ID?.trim()
    ),
    kapsoWebhookSecretConfigured: Boolean(
      process.env.KAPSO_WEBHOOK_SECRET?.trim()
    ),
    cronSecretConfigured: Boolean(process.env.CRON_SECRET?.trim()),
    tokenEncryptionConfigured: Boolean(
      process.env.TOKEN_ENCRYPTION_KEY?.trim() &&
        process.env.TOKEN_ENCRYPTION_KEY.trim().length >= 32
    ),
  };
}
