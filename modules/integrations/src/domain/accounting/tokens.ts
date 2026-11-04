import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Seals OAuth tokens for `connections.tokens_encrypted` (integrations/01 §52). AES-256-GCM with the org id as
// additional authenticated data, so a sealed token copied to another org's row fails to open. Production swaps
// the key source for KMS data keys; the sealed layout stays [version=1][iv 12][tag 16][ciphertext].
export interface TokenVault {
  seal(orgId: string, plaintext: string): Buffer;
  open(orgId: string, sealed: Buffer): string;
}

export interface KeyringVault extends TokenVault {
  /** The key version new values are sealed under. */
  readonly current: number;
  /** The key version a sealed value was written under. */
  versionOf(sealed: Buffer): number;
}

/**
 * A vault over several key versions. The first byte of a sealed value is the version of the key that sealed it, so
 * a new key can be added, new values use it at once, and old values still open until `reseal` has moved them over
 * and the old key is dropped. Versions are 1 to 255; the highest is current.
 */
export function createKeyringVault(keys: ReadonlyMap<number, Buffer>): KeyringVault {
  if (!keys.size) throw new Error('token vault needs at least one key');
  for (const [v, k] of keys) {
    if (!Number.isInteger(v) || v < 1 || v > 255)
      throw new Error('token vault key version must be 1 to 255');
    if (k.length !== 32) throw new Error('token vault key must be 32 bytes');
  }
  const current = Math.max(...keys.keys());
  return {
    current,
    versionOf: (sealed) => sealed[0] ?? 0,
    seal(orgId, plaintext) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', keys.get(current)!, iv);
      c.setAAD(Buffer.from(orgId));
      const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
      return Buffer.concat([Buffer.from([current]), iv, c.getAuthTag(), ct]);
    },
    open(orgId, sealed) {
      const key = keys.get(sealed[0] ?? 0);
      if (!key) throw new Error('unknown token seal version');
      const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(1, 13));
      d.setAAD(Buffer.from(orgId));
      d.setAuthTag(sealed.subarray(13, 29));
      return Buffer.concat([d.update(sealed.subarray(29)), d.final()]).toString('utf8');
    },
  };
}

export function createTokenVault(key: Buffer): TokenVault {
  if (key.length !== 32) throw new Error('token vault key must be 32 bytes');
  return createKeyringVault(new Map([[1, key]]));
}

/**
 * Reads a key setting: either one base64 key (version 1) or `version:base64` pairs separated by commas, for example
 * `1:AAAA…,2:BBBB…`. Throws a plain message that does not repeat any key.
 */
export function parseKeyring(spec: string): Map<number, Buffer> {
  const out = new Map<number, Buffer>();
  const parts = spec
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error('no key given');
  for (const part of parts) {
    const at = part.indexOf(':');
    const version = at === -1 ? 1 : Number(part.slice(0, at));
    const key = Buffer.from(at === -1 ? part : part.slice(at + 1), 'base64');
    if (!Number.isInteger(version) || version < 1 || version > 255)
      throw new Error('key version must be 1 to 255');
    if (key.length !== 32) throw new Error('each key must be 32 bytes, base64 encoded');
    if (out.has(version)) throw new Error(`key version ${version} is given twice`);
    out.set(version, key);
  }
  return out;
}
