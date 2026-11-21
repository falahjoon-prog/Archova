import { defineModule, type KernelServices } from '@archova/kernel';
import { auditRoutes } from './api/routes';
import { createSecurityLogService } from './application/security-log';
import { AUDIT_PERMISSIONS } from './permissions';

/** The security audit log: a hash-chained, append-only record of sign-ins, tokens, exports, access and support. */
export function createAuditModule(services: KernelServices) {
  const log = createSecurityLogService();
  return {
    definition: defineModule({ name: 'audit', permissions: AUDIT_PERMISSIONS }),
    routes: auditRoutes(services.database, log),
  };
}

export type AuditModule = ReturnType<typeof createAuditModule>;
