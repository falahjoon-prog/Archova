import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCloudFrontTileUrls, createMemoryTileUrls } from '../../src/infra/tile-urls';

const now = () => new Date('2026-10-28T00:00:00Z');
const fromCf = (s: string) =>
  Buffer.from(s.replaceAll('-', '+').replaceAll('_', '=').replaceAll('~', '/'), 'base64');

describe('CloudFront tile URLs', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const urls = createCloudFrontTileUrls(
    { domain: 'files.example.test', keyPairId: 'K123', privateKey },
    now,
  );

  it('signs one policy that covers the whole pyramid and nothing outside it', async () => {
    const out = await urls.sign('orgs/o/projects/p/documents/f/tiles', { expiresInS: 3600 });
    expect(out.expiresAt.toISOString()).toBe('2026-10-28T01:00:00.000Z');
    expect(
      out.tileUrlTemplate.startsWith(
        'https://files.example.test/orgs/o/projects/p/documents/f/tiles/{z}/{x}/{y}.webp?',
      ),
    ).toBe(true);

    const q = new URL(out.overviewUrl).searchParams;
    expect(q.get('Key-Pair-Id')).toBe('K123');
    const policyJson = fromCf(q.get('Policy')!).toString();
    const policy = JSON.parse(policyJson);
    expect(policy.Statement[0].Resource).toBe(
      'https://files.example.test/orgs/o/projects/p/documents/f/tiles/*',
    );
    expect(policy.Statement[0].Condition.DateLessThan['AWS:EpochTime']).toBe(
      Math.floor(out.expiresAt.getTime() / 1000),
    );
    const verify = createVerify('RSA-SHA1');
    verify.update(policyJson);
    expect(verify.verify(publicKey, fromCf(q.get('Signature')!))).toBe(true);
  });

  it('uses the same signature for the overview and the tiles', async () => {
    const out = await urls.sign('a/b', { expiresInS: 60 });
    const tail = (u: string) => u.slice(u.indexOf('?'));
    expect(tail(out.tileUrlTemplate)).toBe(tail(out.overviewUrl));
  });
});

describe('memory tile URLs', () => {
  it('keeps the placeholders so a client can be tested without a CDN', async () => {
    const out = await createMemoryTileUrls(now).sign('p', { expiresInS: 10 });
    expect(out.tileUrlTemplate).toContain('{z}/{x}/{y}.webp');
  });
});
