import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Seals secrets for the integrations tables (integrations/01 §52). AES-256-GCM. The additional authenticated data
// binds each blob to its org and its purpose, so a sealed token copied to another org's row, or a webhook secret
// moved into a token column, fails to open. Production swaps the key source for KMS data keys; the layout stays
// [version][iv 12][tag 16][ciphertext]. Only version 2 exists: any other version fails closed.
export type SealPurpose = 'webhook-secret' | 'oauth-tokens' | 'oauth-verifier';

export interface TokenVault {
  seal(orgId: string, purpose: SealPurpose, plaintext: string): Buffer;
  open(orgId: string, purpose: SealPurpose, sealed: Buffer): string;
}

const aad = (orgId: string, purpose: SealPurpose) => Buffer.from(`${purpose}\u0000${orgId}`);

export function createTokenVault(key: Buffer): TokenVault {
  if (key.length !== 32) throw new Error('token vault key must be 32 bytes');
  return {
    seal(orgId, purpose, plaintext) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(aad(orgId, purpose));
      const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
      return Buffer.concat([Buffer.from([2]), iv, c.getAuthTag(), ct]);
    },
    open(orgId, purpose, sealed) {
      if (sealed[0] !== 2) throw new Error('unknown token seal version');
      const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(1, 13));
      d.setAAD(aad(orgId, purpose));
      d.setAuthTag(sealed.subarray(13, 29));
      return Buffer.concat([d.update(sealed.subarray(29)), d.final()]).toString('utf8');
    },
  };
}
