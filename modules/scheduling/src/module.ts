import { defineModule } from '@archova/kernel';
import { schedulingRoutes } from './api/routes';
import { createProgrammeService, type ProgrammeDeps } from './application/programme';
import { SCHEDULING_PERMISSIONS } from './permissions';
import { createRegisterService, type SchedulingDeps } from './application/register';

/**
 * Scheduling: the delay register (X46, product/08), which is read from the diary and RFIs through their public
 * interfaces, and the programme (phase 4): schedules, activities, dependencies, float and critical path, look-aheads and
 * MS Project / P6 import. Notices and delay events come with the EOT work.
 */
export function createSchedulingModule(deps: SchedulingDeps & ProgrammeDeps) {
  const register = createRegisterService(deps);
  const programme = createProgrammeService(deps);
  return {
    definition: defineModule({ name: 'scheduling', permissions: SCHEDULING_PERMISSIONS }),
    routes: schedulingRoutes(deps.database, register, programme),
    api: {},
  };
}

export type SchedulingModule = ReturnType<typeof createSchedulingModule>;
