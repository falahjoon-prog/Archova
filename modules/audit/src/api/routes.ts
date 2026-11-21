import { defineRoutes, requireTenant, type Database } from '@archova/kernel';
import type { SecurityLogService } from '../application/security-log';

export function auditRoutes(database: Database, log: SecurityLogService) {
  const read = <T>(
    input: Parameters<typeof requireTenant>[0],
    fn: Parameters<Database['withTenantTx']>[1],
  ) => database.withTenantTx(requireTenant(input), fn, { readOnly: true }) as Promise<T>;
  return defineRoutes({
    listSecurityAuditEvents: async (input) => ({
      status: 200,
      body: await read(input, (s) => log.list(s, input.query ?? {})),
    }),
    listSecurityAuditAlerts: async (input) => ({
      status: 200,
      body: await read(input, (s) => log.alerts(s)),
    }),
    getSecurityAuditIntegrity: async (input) => ({
      status: 200,
      body: await read(input, (s) => log.integrity(s)),
    }),
  });
}
