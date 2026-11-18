import { describe, expect, it } from 'vitest';
import { operations } from '@archova/contracts';
import { CORE_MODULES } from '@archova/domain';
import { TRIAL_ENTITLEMENTS } from '../../src/application/entitlements';

describe('TRIAL_ENTITLEMENTS', () => {
  it('includes every module that has routes, so a new module cannot ship behind a 403 for pilots', () => {
    const always = new Set<string>([...CORE_MODULES, 'billing']);
    const used = new Set(Object.values(operations).map((d) => d.module as string));
    const missing = [...used].filter(
      (m) => !always.has(m) && !TRIAL_ENTITLEMENTS.modules.includes(m),
    );
    expect(missing).toEqual([]);
  });
});
