import { defineModule, type KernelServices } from '@archova/kernel';
import { createIncidentService } from './application/incidents';
import { createSwmsService, type SafetyDeps } from './application/swms';
import { createReportingSources } from './application/reportingSources';
import { createToolboxService } from './application/toolbox';
import { createReadinessService } from './application/readiness';
import { safetyRoutes } from './api/routes';
import { SAFETY_PERMISSIONS } from './permissions';
import { incidentSyncCommands, incidentSyncSource } from './sync';

export type { SafetyDeps } from './application/swms';

export function createSafetyModule(services: KernelServices, deps: SafetyDeps) {
  const swms = createSwmsService(deps);
  const incidents = createIncidentService(deps);
  const toolbox = createToolboxService(deps);
  const readiness = createReadinessService(deps);
  const reportingSources = createReportingSources(deps);
  return {
    definition: defineModule({ name: 'safety', permissions: SAFETY_PERMISSIONS }),
    routes: safetyRoutes(services.database, swms, incidents, toolbox),
    api: {
      /** What the mobile pull reads (modules/sync). */
      syncSource: incidentSyncSource(incidents),
      /** What a device may queue offline and push (modules/sync). */
      syncCommands: incidentSyncCommands(incidents, deps),
      /** Counts for the tender-readiness pack (`reporting`): last 12 months' incidents and SWMS status on a project. */
      readinessSummary: readiness.summary,
      /** Portfolio dashboard and report builder (`reporting`): incident counts and rows. */
      reporting: reportingSources,
      /** "Stop work: SWMS not followed" (r300). Called by `quality` only, from an observation. */
      reopenForReview: swms.reopenForReview,
      /** Whether a SWMS is on the project, for observations that link to one. Called by `quality` only. */
      exists: swms.exists,
    },
  };
}

export type SafetyModule = ReturnType<typeof createSafetyModule>;
export type SafetyApi = SafetyModule['api'];
