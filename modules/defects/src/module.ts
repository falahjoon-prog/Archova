import { decodeId, encodeId } from '@archova/domain';
import {
  AppError,
  defineModule,
  type KernelServices,
  type SyncCommand,
  type SyncSource,
} from '@archova/kernel';
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
  const invalid = (path: string) =>
    new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  const id = (kind: 'defect' | 'file' | 'company', value: unknown, path: string) => {
    const uuid = typeof value === 'string' ? decodeId(kind, value) : null;
    if (!uuid) throw invalid(path);
    return uuid;
  };
  const textField = (value: unknown, path: string) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string')
      throw new AppError('validation_failed', 'Expected text', [
        { path, message: 'Expected text' },
      ]);
    return value;
  };
  /** `defects.transition`: the REST transition (issue, markReadyForReview, close, reject, reassign, ...) queued offline. */
  const transitionCommand: SyncCommand = {
    name: 'defects.transition',
    module: 'defects',
    async run(scope, m) {
      const defectId = id('defect', m.entityId, 'entityId');
      if (m.baseVersion === null)
        throw new AppError(
          'validation_failed',
          'A transition needs the version it was made against.',
          [{ path: 'baseVersion', message: 'Required' }],
        );
      const p = m.payload;
      if (typeof p.action !== 'string')
        throw new AppError('validation_failed', 'Name the action.', [
          { path: 'payload/action', message: 'Required' },
        ]);
      const reason = textField(p.reason, 'payload/reason');
      const fileIds = p.fileIds === undefined ? undefined : p.fileIds;
      if (fileIds !== undefined && !Array.isArray(fileIds)) throw invalid('payload/fileIds');
      const projectId = await service.projectOf(scope, defectId);
      if (!projectId) throw new AppError('defect.not_found');
      const detail = await service.transition(scope, projectId, defectId, m.baseVersion, {
        action: p.action as never,
        ...(reason ? { reason } : {}),
        ...(fileIds
          ? { fileIds: fileIds.map((f, i) => id('file', f, `payload/fileIds/${i}`)) }
          : {}),
        ...(p.assigneeCompanyId !== undefined
          ? { assigneeCompanyId: id('company', p.assigneeCompanyId, 'payload/assigneeCompanyId') }
          : {}),
      });
      return { version: detail.defect.version };
    },
    async current(scope, entityId) {
      const defectId = typeof entityId === 'string' ? decodeId('defect', entityId) : null;
      if (!defectId) return null;
      const projectId = await service.projectOf(scope, defectId);
      if (!projectId) return null;
      try {
        const { defect, viewer } = await service.detail(scope, projectId, defectId);
        return { version: defect.version, data: toDefectDto(defect, viewer) as never };
      } catch (e) {
        if (e instanceof AppError && e.code === 'defect.not_found') return null;
        throw e;
      }
    },
  };
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
      /** What the mobile pull reads (modules/sync). */
      syncSource,
      /** What a device may queue offline and push (modules/sync). */
      syncCommands: [transitionCommand],
    },
  };
}

export type DefectsModule = ReturnType<typeof createDefectsModule>;
export type DefectsApi = DefectsModule['api'];
