import { defineModule, type KernelServices } from '@archova/kernel';
import { createAttendanceService, type WorkforceDeps } from './application/attendance';
import { workforceRoutes } from './api/routes';
import { WORKFORCE_PERMISSIONS } from './permissions';

export function createWorkforceModule(services: KernelServices, deps: WorkforceDeps) {
  const attendance = createAttendanceService(deps);
  return {
    definition: defineModule({ name: 'workforce', permissions: WORKFORCE_PERMISSIONS }),
    routes: workforceRoutes(services.database, attendance),
    api: {
      /** Scheduled job (every 15 minutes per org): closes sessions left open after the site's day end. */
      closeOverdueSessions: attendance.closeOverdueSessions,
    },
  };
}

export type WorkforceModule = ReturnType<typeof createWorkforceModule>;
export type WorkforceApi = WorkforceModule['api'];
