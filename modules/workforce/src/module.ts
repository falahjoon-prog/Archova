import { defineModule, type KernelServices } from '@archova/kernel';
import { createAttendanceService, type ComplianceSource } from './application/attendance';
import { createInductionService, type InductionDeps } from './application/inductions';
import { workforceRoutes, type InductionHooks } from './api/routes';
import { WORKFORCE_PERMISSIONS } from './permissions';

export function createWorkforceModule(
  services: KernelServices,
  deps: InductionDeps & { hooks?: InductionHooks },
) {
  // The induction rules join the X54 compliance interface ahead of any sources passed in.
  const sources: ComplianceSource[] = [...(deps.complianceSources ?? [])];
  const attendance = createAttendanceService({ ...deps, complianceSources: sources });
  const inductions = createInductionService(deps, attendance);
  sources.unshift(inductions.gateSource);
  return {
    definition: defineModule({ name: 'workforce', permissions: WORKFORCE_PERMISSIONS }),
    routes: workforceRoutes(services.database, attendance, inductions, {
      logger: services.logger,
      ...deps.hooks,
    }),
    api: {
      /** Scheduled job (every 15 minutes per org): closes sessions left open after the site's day end. */
      closeOverdueSessions: attendance.closeOverdueSessions,
      /** For `ai` (ai/12 §3): a published version's slides and quiz (no answers), with internal ids. */
      getInductionVersion: inductions.versionForAi,
    },
  };
}

export type WorkforceModule = ReturnType<typeof createWorkforceModule>;
export type WorkforceApi = WorkforceModule['api'];
