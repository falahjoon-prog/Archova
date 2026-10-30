import { defineModule, type KernelServices } from '@archova/kernel';
import { createSubmittalService, type SubmittalsDeps } from './application/submittals';
import { submittalsRoutes } from './api/routes';
import { SUBMITTALS_PERMISSIONS } from './permissions';

export function createSubmittalsModule(services: KernelServices, deps: SubmittalsDeps) {
  const service = createSubmittalService(deps);
  return {
    definition: defineModule({ name: 'submittals', permissions: SUBMITTALS_PERMISSIONS }),
    routes: submittalsRoutes(services.database, service),
    api: {},
  };
}

export type SubmittalsModule = ReturnType<typeof createSubmittalsModule>;
