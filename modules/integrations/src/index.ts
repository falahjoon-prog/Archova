// Public interface of @archova/mod-integrations.
export { createIntegrationsModule, type IntegrationsModule } from './module';
export { INTEGRATIONS_PERMISSIONS } from './permissions';
export {
  purgeImportStaging,
  STAGING_RETENTION_DAYS,
  type StagingPurgeResult,
} from './application/retention';

export {
  createWebhookService,
  vaultFromKey,
  type WebhookService,
  type WebhooksDeps,
} from './application/webhooks';
export { createHttpsTransport, type WebhookTransport } from './infra/webhook-transport';
export { isPublicEventType, type WebhookPayload } from './domain/webhooks/events';
export * as accounting from './domain/accounting';
export {
  createAccountingService,
  type AccountingDeps,
  type LedgerSourceInput,
  type AccountingService,
} from './application/accounting';
