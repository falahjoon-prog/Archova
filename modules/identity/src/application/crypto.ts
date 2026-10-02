import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, base64url. Used for session cookies, CSRF tokens, refresh tokens and auth codes. */
export const newToken = () => randomBytes(32).toString('base64url');

export const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** PKCE S256: BASE64URL(SHA256(verifier)) === challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return safeEqual(sha256(verifier).toString('base64url'), challenge);
}
