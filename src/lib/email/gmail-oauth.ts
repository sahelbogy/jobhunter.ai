import crypto from "crypto";
import { getPublicEnv } from "@/lib/env";
import {
  decryptSecret,
  encryptSecret,
  signHmacState,
  verifyHmacState,
} from "@/lib/security/encryption";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const GMAIL_MINIMAL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

interface OAuthStatePayload {
  userId: string;
  nonce: string;
  exp: number;
}

function getGoogleOAuthCredentials(): { clientId: string; clientSecret: string } {
  const clientId =
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    process.env.GMAIL_CLIENT_ID?.trim() ||
    "";
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.GMAIL_CLIENT_SECRET?.trim() ||
    "";
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth is not configured on the server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in environment variables."
    );
  }
  return { clientId, clientSecret };
}

export function getGmailRedirectUri(originOverride?: string): string {
  const explicit = process.env.GMAIL_REDIRECT_URI?.trim();
  if (explicit && !originOverride) return explicit;
  const base = (originOverride || getPublicEnv().appUrl).replace(/\/+$/, "");
  return `${base}/api/email/gmail/callback`;
}

export function buildGmailAuthorizationUrl(params: {
  userId: string;
  originOverride?: string;
}): string {
  const { clientId } = getGoogleOAuthCredentials();

  const statePayload: OAuthStatePayload = {
    userId: params.userId,
    nonce: crypto.randomBytes(16).toString("hex"),
    exp: Date.now() + 15 * 60 * 1000, // 15 minutes
  };
  const signedState = signHmacState(statePayload as unknown as Record<string, unknown>);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set(
    "redirect_uri",
    getGmailRedirectUri(params.originOverride)
  );
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GMAIL_MINIMAL_SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", signedState);

  return authUrl.toString();
}

export function verifyGmailOAuthState(
  stateToken: string,
  expectedUserId: string
): boolean {
  const decoded = verifyHmacState<OAuthStatePayload>(stateToken);
  if (!decoded) return false;
  if (decoded.userId !== expectedUserId) return false;
  if (typeof decoded.exp !== "number" || Date.now() > decoded.exp) return false;
  return true;
}

export async function exchangeGmailCodeAndPersist(params: {
  userId: string;
  code: string;
  originOverride?: string;
}): Promise<{ emailAddress: string }> {
  const { clientId, clientSecret } = getGoogleOAuthCredentials();

  const redirectUri = getGmailRedirectUri(params.originOverride);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15000),
  });

  const tokenJson = (await tokenRes.json()) as Record<string, any>;
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_description ||
        tokenJson.error ||
        "Failed to exchange Google authorization code."
    );
  }

  const accessToken = String(tokenJson.access_token);
  const refreshToken = tokenJson.refresh_token
    ? String(tokenJson.refresh_token)
    : null;
  const expiresInSec = Number(tokenJson.expires_in ?? 3599);

  // Fetch connected Google account email address
  const userInfoRes = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    }
  );
  const userInfo = (await userInfoRes.json()) as { email?: string };
  if (!userInfoRes.ok || !userInfo.email) {
    throw new Error("Could not verify connected Gmail email address.");
  }

  const admin = createAdminSupabaseClient();

  // Preserve previous refresh token if Google didn't issue a new one on re-auth
  let encryptedRefreshToken = refreshToken ? encryptSecret(refreshToken) : null;
  if (!encryptedRefreshToken) {
    const { data: existing } = await admin
      .from("email_connections")
      .select("encrypted_refresh_token")
      .eq("user_id", params.userId)
      .maybeSingle();
    encryptedRefreshToken = existing?.encrypted_refresh_token ?? null;
  }

  const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();

  const { error: upsertErr } = await admin.from("email_connections").upsert(
    {
      user_id: params.userId,
      provider: "gmail",
      email_address: userInfo.email.toLowerCase(),
      encrypted_access_token: encryptSecret(accessToken),
      encrypted_refresh_token: encryptedRefreshToken,
      token_expires_at: expiresAt,
      scopes: GMAIL_MINIMAL_SCOPES,
      is_active: true,
      last_connected_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: "user_id" }
  );

  if (upsertErr) {
    throw new Error(`Failed to save Gmail connection: ${upsertErr.message}`);
  }

  return { emailAddress: userInfo.email.toLowerCase() };
}

export async function getValidGmailAccessToken(userId: string): Promise<{
  accessToken: string;
  emailAddress: string;
  connectionId: string;
  dailySendLimit: number;
  sendsToday: number;
  quotaResetDate: string;
}> {
  const admin = createAdminSupabaseClient();
  const { data: conn, error } = await admin
    .from("email_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !conn) {
    throw new Error(
      "No active email account connected. Connect your Gmail account in Email Center before sending."
    );
  }

  if (conn.provider !== "gmail") {
    throw new Error(`Connection provider is '${conn.provider}', not 'gmail'.`);
  }

  const now = Date.now();
  const expiresAtMs = conn.token_expires_at
    ? new Date(conn.token_expires_at).getTime()
    : 0;

  // Return decrypted access token if still valid for > 2 minutes
  if (conn.encrypted_access_token && expiresAtMs - now > 120_000) {
    return {
      accessToken: decryptSecret(conn.encrypted_access_token),
      emailAddress: conn.email_address,
      connectionId: conn.id,
      dailySendLimit: conn.daily_send_limit,
      sendsToday: conn.sends_today,
      quotaResetDate: conn.quota_reset_date,
    };
  }

  // Refresh expired access token using encrypted refresh_token
  if (!conn.encrypted_refresh_token) {
    throw new Error(
      "Gmail session expired and no refresh token is available. Please reconnect Gmail in Email Center."
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth server credentials missing for token refresh.");
  }

  const refreshToken = decryptSecret(conn.encrypted_refresh_token);
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });

  const refreshJson = (await refreshRes.json()) as Record<string, any>;
  if (!refreshRes.ok || !refreshJson.access_token) {
    const errMsg =
      refreshJson.error_description ||
      refreshJson.error ||
      "Gmail token refresh failed.";
    await admin
      .from("email_connections")
      .update({ is_active: false, last_error: errMsg })
      .eq("id", conn.id);
    throw new Error(`Gmail authorization expired (${errMsg}). Please reconnect Gmail.`);
  }

  const newAccessToken = String(refreshJson.access_token);
  const newExpiresAt = new Date(
    Date.now() + Number(refreshJson.expires_in ?? 3599) * 1000
  ).toISOString();

  await admin
    .from("email_connections")
    .update({
      encrypted_access_token: encryptSecret(newAccessToken),
      token_expires_at: newExpiresAt,
      last_error: null,
    })
    .eq("id", conn.id);

  return {
    accessToken: newAccessToken,
    emailAddress: conn.email_address,
    connectionId: conn.id,
    dailySendLimit: conn.daily_send_limit,
    sendsToday: conn.sends_today,
    quotaResetDate: conn.quota_reset_date,
  };
}

export async function disconnectEmailAccount(userId: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { data: conn } = await admin
    .from("email_connections")
    .select("id, provider, encrypted_access_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (conn?.provider === "gmail" && conn.encrypted_access_token) {
    try {
      const token = decryptSecret(conn.encrypted_access_token);
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.timeout(6000),
        }
      );
    } catch {
      // Proceed with local removal even if upstream revocation times out
    }
  }

  await admin.from("email_connections").delete().eq("user_id", userId);
}
