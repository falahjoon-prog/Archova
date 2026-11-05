import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildTimestampRequest,
  createEvidenceSigner,
  parseTimestampResponse,
  requestTimestamp,
  sealMessage,
  sha256Bytes,
} from '../../src/domain/seal-proof';

const pem = generateKeyPairSync('ed25519')
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
const msg = sealMessage({
  kind: 'claim',
  claimId: 'c1',
  sealedAt: '2026-11-05T00:00:00.000Z',
  snapshotSha256: 'a'.repeat(64),
  pdfSha256: 'b'.repeat(64),
});

describe('evidence signature', () => {
  it('verifies its own signature and nothing else', () => {
    const s = createEvidenceSigner('k1', pem);
    const sig = s.sign(msg);
    expect(s.verify(msg, sig, 'k1')).toBe(true);
    expect(s.verify(msg.replace('claim:c1', 'claim:c2'), sig, 'k1')).toBe(false);
    expect(s.verify(msg, sig, 'k2')).toBe(false);
    expect(s.verify(msg, Buffer.alloc(64).toString('base64'), 'k1')).toBe(false);
    expect(s.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });
  it('still verifies records signed by a retired key, and refuses an id it does not hold', () => {
    const old = createEvidenceSigner('k1', pem);
    const sig = old.sign(msg);
    const rotated = createEvidenceSigner(
      'k2',
      generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      { k1: old.publicKeyPem },
    );
    expect(rotated.verify(msg, sig, 'k1')).toBe(true);
    expect(rotated.publicKeyFor('k1')).toBe(old.publicKeyPem);
    expect(rotated.publicKeyFor('k3')).toBeNull();
    expect(rotated.verify(msg, sig, 'k3')).toBe(false);
    expect(() => createEvidenceSigner('k1', pem, { k1: old.publicKeyPem })).toThrow(
      /both current and retired/,
    );
  });
  it('refuses a key that is not Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    });
    expect(() => createEvidenceSigner('k', rsa.toString())).toThrow(/Ed25519/);
  });
});

// --- a synthetic TimeStampResp, built the way an authority would, to exercise the reader ---
const len = (n: number) => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]);
const t = (tag: number, ...body: Buffer[]) => {
  const b = Buffer.concat(body);
  return Buffer.concat([Buffer.from([tag, ...len(b.length)]), b]);
};
function response(imprint: Buffer, nonceHex: string, opts: { status?: number; gen?: string } = {}) {
  const alg = Buffer.from('300d06096086480165030402010500', 'hex');
  const tst = t(
    0x30,
    t(0x02, Buffer.from([1])),
    t(0x06, Buffer.from('2a0304', 'hex')),
    t(0x30, alg, t(0x04, imprint)),
    t(0x02, Buffer.from('0f42', 'hex')),
    t(0x18, Buffer.from(opts.gen ?? '20261105073015Z', 'ascii')),
    t(0x02, Buffer.from(nonceHex, 'hex')),
  );
  const signedData = t(
    0x30,
    t(0x02, Buffer.from([3])),
    t(0x31),
    t(0x30, t(0x06, Buffer.from('2a864886f70d0109100104', 'hex')), t(0xa0, t(0x04, tst))),
  );
  const token = t(0x30, t(0x06, Buffer.from('2a864886f70d010702', 'hex')), t(0xa0, signedData));
  return t(0x30, t(0x30, t(0x02, Buffer.from([opts.status ?? 0]))), token);
}

describe('RFC 3161 timestamp', () => {
  const imprint = sha256Bytes(msg);
  it('builds a request carrying the imprint and a positive nonce', () => {
    const { request, nonceHex } = buildTimestampRequest(
      imprint,
      Buffer.from('ff00112233445566', 'hex'),
    );
    expect(request[0]).toBe(0x30);
    expect(request.includes(imprint)).toBe(true);
    expect(nonceHex).toBe('7f00112233445566');
  });
  it('reads a granted response for this imprint and nonce', () => {
    const r = parseTimestampResponse(response(imprint, '7f00112233445566'), {
      imprint,
      nonceHex: '7f00112233445566',
    });
    expect(r.genTime.toISOString()).toBe('2026-11-05T07:30:15.000Z');
    expect(r.imprintHex).toBe(imprint.toString('hex'));
    expect(r.serialHex).toBe('0f42');
  });
  it('rejects other data, another nonce, a refusal and garbage', () => {
    const ok = response(imprint, '7f00112233445566');
    const exp = { imprint, nonceHex: '7f00112233445566' };
    expect(() => parseTimestampResponse(ok, { ...exp, imprint: sha256Bytes('other') })).toThrow(
      /different data/,
    );
    expect(() => parseTimestampResponse(ok, { ...exp, nonceHex: '7f00000000000001' })).toThrow(
      /different request/,
    );
    expect(() =>
      parseTimestampResponse(response(imprint, '7f00112233445566', { status: 2 }), exp),
    ).toThrow(/refused/);
    expect(() => parseTimestampResponse(Buffer.from('not der'), exp)).toThrow();
    expect(() => parseTimestampResponse(ok.subarray(0, 40), exp)).toThrow();
  });
  it('asks the authority, verifies the chain, and refuses a failed check or a time far from now', async () => {
    const post = async (_u: string, body: Buffer) => {
      const nonce = /0208([0-9a-f]{16})0101ff$/.exec(body.toString('hex'))![1]!;
      return response(imprint, nonce);
    };
    const now = new Date('2026-11-05T07:35:00Z');
    let checked = 0;
    const ok = async () => {
      checked++;
    };
    const r = await requestTimestamp('https://tsa.example/ts', msg, post, ok, now);
    expect(r.token.length).toBeGreaterThan(50);
    expect(checked).toBe(1);
    const bad = async () => {
      throw new Error('did not verify');
    };
    await expect(requestTimestamp('https://tsa.example/ts', msg, post, bad, now)).rejects.toThrow(
      /did not verify/,
    );
    await expect(
      requestTimestamp('https://tsa.example/ts', msg, post, ok, new Date('2026-11-05T08:30:00Z')),
    ).rejects.toThrow(/too far from now/);
  });
});
