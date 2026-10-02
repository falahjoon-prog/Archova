import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64url, createPkce } from '../src';

describe('base64url', () => {
  it('matches Node for every length remainder', () => {
    for (const len of [0, 1, 2, 3, 31, 32, 33]) {
      const bytes = new Uint8Array(Array.from({ length: len }, (_, i) => (i * 37) % 256));
      expect(base64url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    }
  });
});

describe('createPkce', () => {
  it('builds an S256 challenge the API accepts', async () => {
    const pkce = await createPkce(
      (n) => new Uint8Array(n).fill(7),
      async (s) => new Uint8Array(createHash('sha256').update(s).digest()),
    );
    expect(pkce.verifier).toHaveLength(43);
    expect(pkce.challenge).toBe(createHash('sha256').update(pkce.verifier).digest('base64url'));
  });
});
