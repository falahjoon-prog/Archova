import { defineModule, type KernelServices } from '@archova/kernel';
import { createDefectService, type DefectsDeps } from './application/defects';
import { defectsRoutes } from './api/routes';
import { DEFECTS_PERMISSIONS } from './permissions';

export function createDefectsModule(services: KernelServices, deps: DefectsDeps) {
  const service = createDefectService(deps);
  return {
    definition: defineModule({ name: 'defects', permissions: DEFECTS_PERMISSIONS }),
    routes: defectsRoutes(services.database, service),
    api: {
      /** Nova F5: live defects the caller can see near a point on a sheet, for duplicate checks. Called by `ai` only. */
      openNear: service.openNear,
      /** Nova Ask: issued defects with their history notes, to index. Called by `ai` only. */
      aiSources: service.aiSources,
      /** Nova Ask: the scopes the caller holds for defects (builder staff only). */
      aiAccessScopes: service.aiAccessScopes,
    },
  };
}

export type DefectsModule = ReturnType<typeof createDefectsModule>;
export type DefectsApi = DefectsModule['api'];
