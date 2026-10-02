import * as Crypto from 'expo-crypto';
import type { Sha256 } from '@archova/auth-client';

/** Cryptographically secure random bytes from the OS (expo-crypto). */
export const randomBytes = (n: number): Uint8Array => Crypto.getRandomBytes(n);

/** SHA-256 for the PKCE challenge. The verifier is ASCII (base64url), so TextEncoder is exact. */
export const sha256: Sha256 = async (input) =>
  new Uint8Array(
    await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(input)),
  );
