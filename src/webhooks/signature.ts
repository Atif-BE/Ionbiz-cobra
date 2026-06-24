import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256';

// Verifies the IonBiz `ms-signature` header against the raw request body.
// The header is `sha256=<hex>` where <hex> is HMAC-SHA256(rawBody, secret).
// Mirrors the reference C# VerifySecret/SecretEqual: hash the raw bytes and
// compare in constant time. Comparing decoded bytes makes the hex case-insensitive.
export const verifyIonbizSignature = (
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean => {
  if (!signatureHeader) return false;

  const [scheme, hex] = signatureHeader.trim().split('=');
  if (scheme?.toLowerCase() !== SIGNATURE_PREFIX || !hex) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hex, 'hex');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  const actual = createHmac('sha256', secret).update(Buffer.from(rawBody, 'utf8')).digest();
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
};
