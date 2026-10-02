import { hash, verify, type Algorithm } from '@node-rs/argon2';

// Argon2id, memory 19 MiB, t=2 (security-licensing/01 §4).
// `Algorithm` is an ambient const enum (unusable under verbatimModuleSyntax); 2 is Argon2id.
const ARGON2ID = 2 as Algorithm;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** Verified against when the email is unknown, so timing doesn't reveal which emails have accounts. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('archova-dummy-password-for-timing');
  return dummyHash;
}
