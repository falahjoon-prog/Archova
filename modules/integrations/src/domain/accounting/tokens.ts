import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Seals OAuth tokens for `connections.tokens_encrypted` (integrations/01 §52). AES-256-GCM with the org id as
// additional authenticated data, so a sealed token copied to another org's row fails to open. Production swaps
// the key source for KMS data keys; the sealed layout stays [version=1][iv 12][tag 16][ciphertext].
export interface TokenVault {
  seal(orgId: string, plaintext: string): Buffer;
  open(orgId: string, sealed: Buffer): string;
}

export function createTokenVault(key: Buffer): TokenVault {
  if (key.length !== 32) throw new Error('token vault key must be 32 bytes');
  return {
    seal(orgId, plaintext) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(Buffer.from(orgId));
      const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
      return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
    },
    open(orgId, sealed) {
      if (sealed[0] !== 1) throw new Error('unknown token seal version');
      const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(1, 13));
      d.setAAD(Buffer.from(orgId));
      d.setAuthTag(sealed.subarray(13, 29));
      return Buffer.concat([d.update(sealed.subarray(29)), d.final()]).toString('utf8');
    },
  };
}
