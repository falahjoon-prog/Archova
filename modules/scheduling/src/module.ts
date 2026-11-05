import { defineModule } from '@archova/kernel';
import { schedulingRoutes } from './api/routes';
import { createLinksService, type LinksDeps } from './application/links';
import { createProgrammeService, type ProgrammeDeps } from './application/programme';
import { SCHEDULING_PERMISSIONS } from './permissions';
import { createReportingSources, type ReportingSourcesDeps } from './application/reportingSources';
import { createRegisterService, type SchedulingDeps } from './application/register';

/**
 * Scheduling: the delay register (X46, product/08), which is read from the diary and RFIs through their public
 * interfaces, and the programme (phase 4): schedules, activities, dependencies, float and critical path, look-aheads and
 * MS Project / P6 import, and the RFIs and submittals tied to activities (read through their public interfaces). Notices and delay events come with the EOT work.
 */
export function createSchedulingModule(
  deps: SchedulingDeps & ProgrammeDeps & LinksDeps & Pick<ReportingSourcesDeps, 'access'>,
) {
  const register = createRegisterService(deps);
  const programme = createProgrammeService(deps);
  const links = createLinksService(deps);
  const reportingSources = createReportingSources(deps);
  return {
    definition: defineModule({ name: 'scheduling', permissions: SCHEDULING_PERMISSIONS }),
    routes: schedulingRoutes(deps.database, register, programme, links),
    api: {
      /** Portfolio dashboard and report builder (`reporting`): programme activity counts and rows. */
      reporting: reportingSources,
    },
  };
}

export type SchedulingModule = ReturnType<typeof createSchedulingModule>;
