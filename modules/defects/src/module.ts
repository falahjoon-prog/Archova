import { defineModule, type KernelServices } from '@archova/kernel';
import { createDefectService, type DefectsDeps } from './application/defects';
import { defectsRoutes } from './api/routes';
import { DEFECTS_PERMISSIONS } from './permissions';

export function createDefectsModule(services: KernelServices, deps: DefectsDeps) {
  const service = createDefectService(deps);
  return {
    definition: defineModule({ name: 'defects', permissions: DEFECTS_PERMISSIONS }),
    routes: defectsRoutes(services.database, service),
    api: {},
  };
}

export type DefectsModule = ReturnType<typeof createDefectsModule>;
export type DefectsApi = DefectsModule['api'];
