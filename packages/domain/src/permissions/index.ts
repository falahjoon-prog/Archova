export * from './model';
export * from './keys';
export * from './templates';

import type { EffectivePermissions } from './model';
import { evaluate } from './model';
import { FOUNDATION_REGISTRY } from './keys';

/** Client-side convenience over the foundation registry. Hides UI only; the API re-checks. */
export function can(perms: EffectivePermissions, key: string): boolean {
  return evaluate(perms, key, FOUNDATION_REGISTRY).allow;
}

/** True when the org's entitlements include a module (`hasModule(ent, 'financials')`). */
export function hasModule(entitlements: { modules: readonly string[] }, module: string): boolean {
  return entitlements.modules.includes(module);
}
