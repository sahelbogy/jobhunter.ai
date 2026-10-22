import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function deriveEncryptionKey(rawKey?: string): Buffer {
  const secret = (rawKey ?? process.env.TOKEN_ENCRYPTION_KEY ?? "").trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be configured on the server with at least 32 characters."
    );
  }

  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, "hex");
  }

  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSecret(plaintext: string, rawKey?: string): string {
  if (!plaintext) {
    throw new Error("Cannot encrypt empty secret value.");
  }
  const key = deriveEncryptionKey(rawKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string, rawKey?: string): string {
  if (!payload) {
    throw new Error("Cannot decrypt empty ciphertext.");
  }

  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unsupported or corrupted encrypted token format.");
  }

  const [, ivB64, tagB64, dataB64] = parts;
  const key = deriveEncryptionKey(rawKey);
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(tagB64, "base64url");
  const ciphertext = Buffer.from(dataB64, "base64url");

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid IV or authentication tag length.");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function signHmacState(payload: Record<string, unknown>, rawKey?: string): string {
  const key = deriveEncryptionKey(rawKey);
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", key)
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

export function verifyHmacState<T = Record<string, unknown>>(
  token: string,
  rawKey?: string
): T | null {
  try {
    const [data, signature] = token.split(".");
    if (!data || !signature) return null;
    const key = deriveEncryptionKey(rawKey);
    const expected = crypto
      .createHmac("sha256", key)
      .update(data)
      .digest("base64url");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
