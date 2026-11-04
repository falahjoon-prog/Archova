import { encodeId } from '@archova/domain';
import { defineModule, type KernelServices, type SyncSource } from '@archova/kernel';
import { createRfiService, type RfisDeps } from './application/rfis';
import { rfisRoutes } from './api/routes';
import { toRfiDto } from './api/mappers';
import { RFIS_PERMISSIONS } from './permissions';

export function createRfisModule(services: KernelServices, deps: RfisDeps) {
  const service = createRfiService(deps);
  const syncSource: SyncSource = {
    module: 'rfis',
    permission: 'rfis.rfis.read',
    publicId: (_entityType, id) => encodeId('rfi', id),
    async load(scope, { projectId, entityType, ids }) {
      const out = new Map<string, { version: number; data: Record<string, unknown> }>();
      if (!projectId || entityType !== 'rfi') return out;
      for (const r of await service.visibleAmong(scope, projectId, ids))
        out.set(r.id, {
          version: r.version,
          data: toRfiDto(r) as unknown as Record<string, unknown>,
        });
      return out;
    },
  };
  return {
    definition: defineModule({ name: 'rfis', permissions: RFIS_PERMISSIONS }),
    routes: rfisRoutes(services.database, service),
    api: {
      /** What the mobile pull reads (modules/sync). */
      syncSource,
      /** X49 import command; called by the integrations import job only. */
      importRfi: service.importRfi,
      /** Nova F3: RFIs the caller can see on the same subject, with who was asked. Called by `ai` only. */
      findSimilar: service.findSimilar,
      /** Nova Ask (F2): sent RFIs with their responses, to index (one RFI when `only` is given); and the Ask scopes the caller holds for them. Called by `ai` only. */
      aiSources: service.aiSources,
      aiAccessScopes: service.aiAccessScopes,
      /** The delay register (`scheduling`): RFIs the caller can see that carry a schedule impact or were answered late. */
      timeImpacts: service.timeImpacts,
      /** Meeting agenda (`meetings`): open RFIs past their due date that the caller can see. */
      overdueForMeeting: service.overdueForMeeting,
      /** Nova F21: open RFIs the caller can see pinned to these drawing revisions. Called by `ai` only. */
      openOnDrawing: service.openOnDrawing,
      /** Nova F3: an RFI and its responses for drafting a response, if the caller could send one. Called by `ai` only. */
      forAnswerDraft: service.forAnswerDraft,
    },
  };
}

export type RfisModule = ReturnType<typeof createRfisModule>;
export type RfisApi = RfisModule['api'];
