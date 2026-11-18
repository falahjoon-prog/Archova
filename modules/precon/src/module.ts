import { defineModule, type KernelServices } from '@archova/kernel';
import { createPrequalService } from './application/prequalifications';
import type { PreconDeps } from './application/shared';
import { createSettingsService } from './application/settings';
import { createTemplateService } from './application/templates';
import { preconRoutes } from './api/routes';
import { PRECON_PERMISSIONS } from './permissions';

export type { PreconDeps } from './application/shared';

export function createPreconModule(services: KernelServices, deps: PreconDeps) {
  const templates = createTemplateService();
  const forms = createPrequalService(deps);
  const settings = createSettingsService(deps);
  return {
    definition: defineModule({ name: 'precon', permissions: PRECON_PERMISSIONS }),
    routes: preconRoutes(services.database, templates, forms, settings),
    api: { tenderGate: settings.tenderGate, readinessSummary: settings.readinessSummary },
  };
}

export type PreconModule = ReturnType<typeof createPreconModule>;
