import { describe, expect, it } from 'vitest';
import { createNumberVault } from '../../src/domain/number-vault';

const vault = createNumberVault(Buffer.alloc(32, 3));
const org = '0190aaaa-0000-7000-8000-000000000001';
const row = '0190aaaa-0000-7000-8000-000000000002';

describe('wallet number vault', () => {
  it('round-trips and never stores the plaintext', () => {
    const sealed = vault.seal(org, 'wallet-document-number', row, 'PL-12345678');
    expect(sealed.includes(Buffer.from('12345678'))).toBe(false);
    expect(vault.open(org, 'wallet-document-number', row, sealed)).toBe('PL-12345678');
  });
  it('seals the same number differently each time', () => {
    const a = vault.seal(org, 'wallet-document-number', row, 'X1');
    const b = vault.seal(org, 'wallet-document-number', row, 'X1');
    expect(a.equals(b)).toBe(false);
  });
  it('will not open under another org, row or purpose', () => {
    const sealed = vault.seal(org, 'wallet-document-number', row, 'X1');
    expect(() => vault.open('other', 'wallet-document-number', row, sealed)).toThrow();
    expect(() => vault.open(org, 'wallet-document-number', 'other', sealed)).toThrow();
    expect(() => vault.open(org, 'worker-credential-number', row, sealed)).toThrow();
  });
  it('fails closed on tampering, an unknown version and a wrong key', () => {
    const sealed = vault.seal(org, 'wallet-document-number', row, 'X1');
    const bad = Buffer.from(sealed);
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
    expect(() => vault.open(org, 'wallet-document-number', row, bad)).toThrow();
    const v9 = Buffer.from(sealed);
    v9[0] = 9;
    expect(() => vault.open(org, 'wallet-document-number', row, v9)).toThrow(/version/);
    expect(() =>
      createNumberVault(Buffer.alloc(32, 4)).open(org, 'wallet-document-number', row, sealed),
    ).toThrow();
  });
  it('needs a 32 byte key', () => expect(() => createNumberVault(Buffer.alloc(16))).toThrow());
});
