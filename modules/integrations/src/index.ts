// Public interface of @archova/mod-integrations.
export { createIntegrationsModule, type IntegrationsModule } from './module';
export { INTEGRATIONS_PERMISSIONS } from './permissions';
export {
  purgeImportStaging,
  STAGING_RETENTION_DAYS,
  type StagingPurgeResult,
} from './application/retention';
export * as accounting from './domain/accounting';
