import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Seals the full licence, card and policy numbers held by the compliance wallet and worker credentials
// (compliance/05 §7: "number (encrypted, plus last 4)"). AES-256-GCM. The additional authenticated data binds each
// blob to its org, its purpose and its row, so a sealed number copied to another row or table fails to open.
// Layout [version 1][iv 12][tag 16][ciphertext]; any other version fails closed. Production swaps the key source for
// KMS data keys; the layout stays. The key is this module's own (API_WALLET_SECRET_KEY), never shared with webhooks
// or accounting tokens.
export type NumberPurpose = 'wallet-document-number' | 'worker-credential-number';

export interface NumberVault {
  seal(orgId: string, purpose: NumberPurpose, recordId: string, plaintext: string): Buffer;
  open(orgId: string, purpose: NumberPurpose, recordId: string, sealed: Buffer): string;
}

const aad = (orgId: string, purpose: NumberPurpose, recordId: string) =>
  Buffer.from(`${purpose}\u0000${orgId}\u0000${recordId}`);

export function createNumberVault(key: Buffer): NumberVault {
  if (key.length !== 32) throw new Error('wallet number key must be 32 bytes');
  return {
    seal(orgId, purpose, recordId, plaintext) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      c.setAAD(aad(orgId, purpose, recordId));
      const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
      return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
    },
    open(orgId, purpose, recordId, sealed) {
      if (sealed[0] !== 1) throw new Error('unknown number seal version');
      const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(1, 13));
      d.setAAD(aad(orgId, purpose, recordId));
      d.setAuthTag(sealed.subarray(13, 29));
      return Buffer.concat([d.update(sealed.subarray(29)), d.final()]).toString('utf8');
    },
  };
}

export const numberVaultFromKey = (base64Key: string) =>
  createNumberVault(Buffer.from(base64Key, 'base64'));
