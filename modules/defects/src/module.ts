import { encodeId } from '@archova/domain';
import { defineModule, type KernelServices, type SyncSource } from '@archova/kernel';
import { createDefectService, type DefectsDeps } from './application/defects';
import { defectsRoutes } from './api/routes';
import { toDefectDto } from './api/mappers';
import { DEFECTS_PERMISSIONS } from './permissions';

export function createDefectsModule(services: KernelServices, deps: DefectsDeps) {
  const service = createDefectService(deps);
  const syncSource: SyncSource = {
    module: 'defects',
    permission: 'defects.defects.read',
    publicId: (_type, id) => encodeId('defect', id),
    async load(scope, { projectId, ids }) {
      if (!projectId) return new Map();
      const { rows, viewer } = await service.visibleAmong(scope, projectId, ids);
      return new Map(
        rows.map((r) => [r.id, { version: r.version, data: toDefectDto(r, viewer) as never }]),
      );
    },
  };
  return {
    definition: defineModule({ name: 'defects', permissions: DEFECTS_PERMISSIONS }),
    routes: defectsRoutes(services.database, service),
    api: {
      /** Nova F5: live defects the caller can see near a point on a sheet, for duplicate checks. Called by `ai` only. */
      openNear: service.openNear,
      /** Nova Ask: issued defects with their history notes, to index (one defect when `only` is given). Called by `ai` only. */
      aiSources: service.aiSources,
      /** Nova Ask: the scopes the caller holds for defects (builder staff only). */
      aiAccessScopes: service.aiAccessScopes,
      /** What the mobile pull reads (modules/sync). */
      syncSource,
    },
  };
}

export type DefectsModule = ReturnType<typeof createDefectsModule>;
export type DefectsApi = DefectsModule['api'];
