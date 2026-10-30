import { defineModule } from '@archova/kernel';
import { schedulingRoutes } from './api/routes';
import { createRegisterService, type SchedulingDeps } from './application/register';

/**
 * Scheduling, phase 1b: the delay register only (X46, product/08). It owns no tables yet - the register is read from
 * the diary and RFIs through their public interfaces. Notices, delay events and the programme come in phases 2 and 4.
 */
export function createSchedulingModule(deps: SchedulingDeps) {
  const register = createRegisterService(deps);
  return {
    definition: defineModule({ name: 'scheduling' }),
    routes: schedulingRoutes(register),
    api: {},
  };
}

export type SchedulingModule = ReturnType<typeof createSchedulingModule>;
