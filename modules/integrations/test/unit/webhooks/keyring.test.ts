import { describe, expect, it } from 'vitest';
import { createKeyringVault, parseKeyring } from '../../../src/domain/accounting/tokens';

const k = (n: number) => Buffer.alloc(32, n).toString('base64');

describe('keyring vault', () => {
  it('seals under the highest version and still opens values from older ones', () => {
    const old = createKeyringVault(parseKeyring(`1:${k(1)}`));
    const sealedOld = old.seal('org-1', 'whsec_old');
    const both = createKeyringVault(parseKeyring(`1:${k(1)},2:${k(2)}`));
    expect(both.current).toBe(2);
    expect(both.versionOf(sealedOld)).toBe(1);
    expect(both.open('org-1', sealedOld)).toBe('whsec_old');
    const sealedNew = both.seal('org-1', 'whsec_new');
    expect(both.versionOf(sealedNew)).toBe(2);
    // Once the old key is dropped, old values no longer open but new ones do.
    const onlyNew = createKeyringVault(parseKeyring(`2:${k(2)}`));
    expect(onlyNew.open('org-1', sealedNew)).toBe('whsec_new');
    expect(() => onlyNew.open('org-1', sealedOld)).toThrow('unknown token seal version');
  });

  it('binds a value to its org', () => {
    const v = createKeyringVault(parseKeyring(k(1)));
    expect(() => v.open('org-2', v.seal('org-1', 'x'))).toThrow();
  });

  it('reads a bare key as version 1 and refuses bad settings without echoing them', () => {
    expect(createKeyringVault(parseKeyring(k(1))).current).toBe(1);
    for (const bad of [
      '',
      'c2hvcnQ=',
      `0:${k(1)}`,
      `256:${k(1)}`,
      `1:${k(1)},1:${k(2)}`,
      `x:${k(1)}`,
    ])
      expect(() => parseKeyring(bad)).toThrow();
    try {
      parseKeyring('c2hvcnQ=');
    } catch (e) {
      expect((e as Error).message).not.toContain('c2hvcnQ=');
    }
  });
});
