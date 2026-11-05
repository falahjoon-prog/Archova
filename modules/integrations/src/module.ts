import { defineModule, type KernelServices } from '@archova/kernel';
import { createAccountingService, type AccountingDeps } from './application/accounting';
import { createFoldersService } from './application/folders';
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
  const folders = createFoldersService({
    vault: deps.accounting.vault,
    fetch: deps.accounting.fetch,
    redirectBase: `${deps.accounting.redirectBase.replace(/\/accounting$/, '')}/folders`,
    credentials: deps.accounting.folders?.credentials ?? { m365: null, google: null },
    platform: deps.platform,
    files: deps.files,
    ...(deps.accounting.folders?.providerOverride
      ? { providerOverride: deps.accounting.folders.providerOverride }
      : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
  const availableFolders = (['m365', 'google'] as const).filter(
    (p) => deps.accounting.folders?.credentials[p] || deps.accounting.folders?.providerOverride,
  );
  const available = (['xero', 'myob'] as const).filter((p) => deps.accounting.credentials[p]);
  return {
    definition: defineModule({ name: 'integrations', permissions: INTEGRATIONS_PERMISSIONS }),
    routes: integrationsRoutes(
      services.database,
      imports,
      webhooks,
      accounting,
      available,
      folders,
      availableFolders,
      services.redis,
    ),
    api: { accounting, folders },
  };
}

export type IntegrationsModule = ReturnType<typeof createIntegrationsModule>;
