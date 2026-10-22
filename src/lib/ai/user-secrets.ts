import type { AiProviderId } from "@/types/domain";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";

export interface UserAiKeySummary {
  hasUserKey: boolean;
  keyHint: string | null;
  updatedAt: string | null;
}

export async function getUserAiSecretSummary(
  userId: string
): Promise<Record<AiProviderId, UserAiKeySummary>> {
  const empty: Record<AiProviderId, UserAiKeySummary> = {
    groq: { hasUserKey: false, keyHint: null, updatedAt: null },
    gemini: { hasUserKey: false, keyHint: null, updatedAt: null },
    xai: { hasUserKey: false, keyHint: null, updatedAt: null },
  };

  if (!userId) return empty;

  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("user_ai_secrets")
      .select("provider, key_hint, updated_at")
      .eq("user_id", userId);

    for (const row of data ?? []) {
      const p = row.provider as AiProviderId;
      if (p in empty) {
        empty[p] = {
          hasUserKey: true,
          keyHint: row.key_hint ?? null,
          updatedAt: row.updated_at ?? null,
        };
      }
    }
  } catch {
    // Graceful no-op when admin client is unconfigured in isolated unit tests
  }

  return empty;
}

export async function getDecryptedUserAiKeys(
  userId?: string | null
): Promise<Partial<Record<AiProviderId, string>>> {
  if (!userId) return {};

  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from("user_ai_secrets")
      .select("provider, encrypted_api_key")
      .eq("user_id", userId);

    const out: Partial<Record<AiProviderId, string>> = {};
    for (const row of data ?? []) {
      const p = row.provider as AiProviderId;
      if (row.encrypted_api_key) {
        try {
          const decrypted = decryptSecret(row.encrypted_api_key).trim();
          if (decrypted) {
            out[p] = decrypted;
          }
        } catch {
          // Ignore corrupted ciphertexts
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveUserAiSecret(params: {
  userId: string;
  provider: AiProviderId;
  apiKey: string;
}): Promise<{ keyHint: string }> {
  const trimmed = params.apiKey.trim();
  if (trimmed.length < 10) {
    throw new Error("API key appears too short.");
  }

  const encrypted = encryptSecret(trimmed);
  const keyHint = `••••${trimmed.slice(-4)}`;

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("user_ai_secrets").upsert(
    {
      user_id: params.userId,
      provider: params.provider,
      encrypted_api_key: encrypted,
      key_hint: keyHint,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );

  if (error) {
    throw new Error(`Failed to store encrypted API key: ${error.message}`);
  }

  return { keyHint };
}

export async function deleteUserAiSecret(params: {
  userId: string;
  provider: AiProviderId;
}): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("user_ai_secrets")
    .delete()
    .eq("user_id", params.userId)
    .eq("provider", params.provider);

  if (error) {
    throw new Error(`Failed to remove API key: ${error.message}`);
  }
}
