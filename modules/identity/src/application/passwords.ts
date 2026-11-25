import { createRequire } from 'node:module';
import type * as Argon2 from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';

// Argon2id, memory 19 MiB, t=2 (security-licensing/01 §4).
// `Algorithm` is an ambient const enum (unusable under verbatimModuleSyntax); 2 is Argon2id.
const ARGON2ID = 2 as Algorithm;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

// Loaded on first use through `createRequire`, which the bundler leaves alone: the worker bundles this module (the
// platform routes import the identity index) and its image carries no argon2, so a static import would crash it at
// start (apps/worker ai-routing test). The api image has it.
const requireModule = createRequire(import.meta.url);
const argon2 = () => requireModule('@node-rs/argon2') as typeof Argon2;

export const hashPassword = async (password: string) => argon2().hash(password, OPTIONS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await argon2().verify(stored, password);
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
