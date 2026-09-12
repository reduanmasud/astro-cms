import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HocusPocus signs every webhook request with
 * `X-Hocuspocus-Signature-256: sha256=<hex>`, an HMAC-SHA256 of the exact
 * request body using HOCUSPOCUS_WEBHOOK_SECRET.
 */

export const SIGNATURE_HEADER = "X-Hocuspocus-Signature-256";

export function createSignature(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Constant-time check of the signature header against the raw body. */
export function isValidSignature(
  secret: string,
  body: string,
  header: string | undefined,
): boolean {
  if (header === undefined) return false;
  const expected = Buffer.from(createSignature(secret, body), "utf8");
  const received = Buffer.from(header, "utf8");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
