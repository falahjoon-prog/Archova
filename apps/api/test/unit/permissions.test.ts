import { describe, expect, it } from 'vitest';
import { operations } from '@archova/contracts';
import { FOUNDATION_PERMISSIONS, buildRegistry } from '@archova/domain/permissions';
import { MODULE_PERMISSIONS } from '@archova/compose';

describe('permission registry', () => {
  const registry = buildRegistry(FOUNDATION_PERMISSIONS, ...MODULE_PERMISSIONS);

  it('registers every x-permission in the contract (unknown keys would deny everyone)', () => {
    for (const [id, op] of Object.entries(operations)) {
      if (op.permission) expect(registry.has(op.permission), `${id}: ${op.permission}`).toBe(true);
    }
  });

  it('keeps each module to its own key prefix', () => {
    for (const list of MODULE_PERMISSIONS) {
      const prefixes = new Set(list.map((p) => p.key.split('.')[0]));
      expect(prefixes.size).toBe(1);
    }
  });
});
