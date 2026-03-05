import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for Shopify access tokens.
 *
 * Format stored in DB:  `<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`
 *
 * Uses SHOPIFY_TOKEN_ENCRYPTION_KEY env var.
 * Falls back to META_TOKEN_ENCRYPTION_KEY if not set (shared key for simplicity).
 * Generate with:  openssl rand -hex 32
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex =
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY ??
    process.env.META_TOKEN_ENCRYPTION_KEY;

  if (!hex || hex.length !== 64) {
    throw new Error(
      "SHOPIFY_TOKEN_ENCRYPTION_KEY (or META_TOKEN_ENCRYPTION_KEY) must be a 64-character hex string. " +
        "Generate with: openssl rand -hex 32",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptShopifyToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

export function decryptShopifyToken(stored: string): string {
  const key = getKey();
  const [ivHex, tagHex, ciphertextHex] = stored.split(":");

  if (!ivHex || !tagHex || !ciphertextHex) {
    throw new Error("Invalid encrypted token format");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, "hex"),
    { authTagLength: TAG_LENGTH },
  );

  decipher.setAuthTag(Buffer.from(tagHex, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
