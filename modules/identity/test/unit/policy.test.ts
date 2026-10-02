import { describe, expect, it } from 'vitest';
import {
  SESSION_IDLE_MS,
  isSessionActive,
  nextIdleExpiry,
  passwordProblems,
} from '../../src/domain/policy';
import { sha256, verifyPkce } from '../../src/application/crypto';

describe('session policy', () => {
  const now = new Date('2026-10-02T00:00:00Z');
  it('expires on idle, absolute and revocation', () => {
    const later = new Date(now.getTime() + 1000);
    expect(
      isSessionActive({ idleExpiresAt: later, absoluteExpiresAt: later, revokedAt: null }, now),
    ).toBe(true);
    expect(
      isSessionActive({ idleExpiresAt: now, absoluteExpiresAt: later, revokedAt: null }, now),
    ).toBe(false);
    expect(
      isSessionActive({ idleExpiresAt: later, absoluteExpiresAt: now, revokedAt: null }, now),
    ).toBe(false);
    expect(
      isSessionActive({ idleExpiresAt: later, absoluteExpiresAt: later, revokedAt: now }, now),
    ).toBe(false);
  });
  it('caps the idle extension at the absolute expiry', () => {
    const abs = new Date(now.getTime() + 60_000);
    expect(nextIdleExpiry(now, abs)).toEqual(abs);
    const far = new Date(now.getTime() + 10 * SESSION_IDLE_MS);
    expect(nextIdleExpiry(now, far).getTime()).toBe(now.getTime() + SESSION_IDLE_MS);
  });
});

describe('passwords', () => {
  it('needs 10+ characters and no email local part', () => {
    expect(passwordProblems('short', 'sam@example.com')).toHaveLength(1);
    expect(passwordProblems('builder-site-2026', 'jane.builder@example.com')).toHaveLength(0);
    expect(passwordProblems('janebuilder-2026', 'janebuilder@example.com')).toHaveLength(1);
  });
});

describe('PKCE', () => {
  it('accepts the S256 challenge of the verifier and nothing else', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = sha256(verifier).toString('base64url');
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(verifier + 'x', challenge)).toBe(false);
    expect(verifyPkce('too-short', challenge)).toBe(false);
  });
});
