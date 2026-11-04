import { defineModule, type KernelServices } from '@archova/kernel';
import { createSwmsService, type SafetyDeps } from './application/swms';
import { safetyRoutes } from './api/routes';
import { SAFETY_PERMISSIONS } from './permissions';

export type { SafetyDeps } from './application/swms';

export function createSafetyModule(services: KernelServices, deps: SafetyDeps) {
  const swms = createSwmsService(deps);
  return {
    definition: defineModule({ name: 'safety', permissions: SAFETY_PERMISSIONS }),
    routes: safetyRoutes(services.database, swms),
    api: {
      /** "Stop work: SWMS not followed" (r300). Called by `quality` only, from an observation. */
      reopenForReview: swms.reopenForReview,
      /** Whether a SWMS is on the project, for observations that link to one. Called by `quality` only. */
      exists: swms.exists,
    },
  };
}

export type SafetyModule = ReturnType<typeof createSafetyModule>;
export type SafetyApi = SafetyModule['api'];
