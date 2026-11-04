import { defineModule, type KernelServices } from '@archova/kernel';
import { createAccountingService, type AccountingDeps } from './application/accounting';
import { createImportService, type ImportsDeps } from './application/imports';
import { createWebhookService, type WebhooksDeps } from './application/webhooks';
import { integrationsRoutes } from './api/routes';
import { INTEGRATIONS_PERMISSIONS } from './permissions';

export function createIntegrationsModule(
  services: KernelServices,
  deps: ImportsDeps & { webhooks: WebhooksDeps; accounting: AccountingDeps },
) {
  const imports = createImportService(deps);
  const webhooks = createWebhookService(deps.webhooks);
  const accounting = createAccountingService({ database: services.database, ...deps.accounting });
  const available = (['xero', 'myob'] as const).filter((p) => deps.accounting.credentials[p]);
  return {
    definition: defineModule({ name: 'integrations', permissions: INTEGRATIONS_PERMISSIONS }),
    routes: integrationsRoutes(
      services.database,
      imports,
      webhooks,
      accounting,
      available,
      services.redis,
    ),
    api: { accounting },
  };
}

export type IntegrationsModule = ReturnType<typeof createIntegrationsModule>;
