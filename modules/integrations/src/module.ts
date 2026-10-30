import { defineModule, type KernelServices } from '@archova/kernel';
import { createImportService, type ImportsDeps } from './application/imports';
import { createWebhookService, type WebhooksDeps } from './application/webhooks';
import { integrationsRoutes } from './api/routes';
import { INTEGRATIONS_PERMISSIONS } from './permissions';

export function createIntegrationsModule(
  services: KernelServices,
  deps: ImportsDeps & { webhooks: WebhooksDeps },
) {
  const imports = createImportService(deps);
  const webhooks = createWebhookService(deps.webhooks);
  return {
    definition: defineModule({ name: 'integrations', permissions: INTEGRATIONS_PERMISSIONS }),
    routes: integrationsRoutes(services.database, imports, webhooks),
    api: {},
  };
}

export type IntegrationsModule = ReturnType<typeof createIntegrationsModule>;
