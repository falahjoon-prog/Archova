import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineModule,
  type KernelServices,
  type SyncCommand,
  type SyncSource,
} from '@archova/kernel';
import { createInspectionService, type InspectionService } from './application/inspections';
import type { ResponseInput } from './application/inspections';
import { createObservationService } from './application/observations';
import type { QualityDeps } from './application/shared';
import { qualityRoutes } from './api/routes';
import { toInspectionDetail } from './api/mappers';
import { QUALITY_PERMISSIONS } from './permissions';

export type { QualityDeps } from './application/shared';

const invalid = (path: string, message = 'Invalid') =>
  new AppError('validation_failed', message, [{ path, message }]);

function id(kind: IdKind, value: unknown, path: string): string {
  const uuid = typeof value === 'string' ? decodeId(kind, value) : null;
  if (!uuid) throw invalid(path, 'Invalid id');
  return uuid;
}

/** The `responses` of a queued `quality.recordResponses`, checked to the shape the REST endpoint accepts. */
function parseResponses(payload: Record<string, unknown>): ResponseInput[] {
  const list = payload.responses;
  if (!Array.isArray(list) || list.length === 0 || list.length > 300)
    throw invalid('payload/responses', 'Send between 1 and 300 answers');
  return list.map((raw, n) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const path = `payload/responses/${n}`;
    const out: ResponseInput = {
      templateItemId: id('inspectionItem', r.templateItemId, `${path}/templateItemId`),
    };
    if (r.value !== undefined) {
      if (!['string', 'number', 'boolean'].includes(typeof r.value)) throw invalid(`${path}/value`);
      out.value = r.value as string | number | boolean;
    }
    if (r.result !== undefined) {
      if (typeof r.result !== 'string') throw invalid(`${path}/result`);
      out.result = r.result as never;
    }
    if (r.note !== undefined) {
      if (typeof r.note !== 'string' || r.note.length > 2000) throw invalid(`${path}/note`);
      out.note = r.note;
    }
    if (r.fileIds !== undefined) {
      if (!Array.isArray(r.fileIds) || r.fileIds.length > 20) throw invalid(`${path}/fileIds`);
      out.fileIds = r.fileIds.map((f, i) => id('file', f, `${path}/fileIds/${i}`));
    }
    return out;
  });
}

export function syncPieces(inspections: InspectionService) {
  const dto = (d: Awaited<ReturnType<InspectionService['detail']>>) => ({
    version: d.inspection.version,
    // The Inspection fields stay at the top level (the device files the record by its `projectId`), with the
    // checklist and answers alongside.
    data: (({ inspection, ...rest }) => ({ ...inspection, ...rest }))(
      toInspectionDetail(d),
    ) as unknown as Record<string, unknown>,
  });

  const syncSource: SyncSource = {
    module: 'quality',
    permission: 'quality.inspections.read',
    publicId: (entityType, uuid) =>
      encodeId(entityType === 'observation' ? 'observation' : 'inspection', uuid),
    async load(scope, { projectId, entityType, ids }) {
      const out = new Map<string, { version: number; data: Record<string, unknown> }>();
      // Observations are online-only for now; their changes reach the device as deletes of nothing.
      if (!projectId || entityType !== 'inspection') return out;
      for (const d of await inspections.visibleAmong(scope, projectId, ids))
        out.set(d.inspection.id, dto(d));
      return out;
    },
  };

  const current: SyncCommand['current'] = async (scope, entityId) => {
    const inspectionId = typeof entityId === 'string' ? decodeId('inspection', entityId) : null;
    if (!inspectionId) return null;
    const projectId = await inspections.projectOf(scope, inspectionId);
    if (!projectId) return null;
    try {
      return dto(await inspections.detail(scope, projectId, inspectionId));
    } catch (e) {
      if (e instanceof AppError && e.code === 'inspection.not_found') return null;
      throw e;
    }
  };

  async function target(scope: Parameters<SyncCommand['run']>[0], entityId: string) {
    const inspectionId = id('inspection', entityId, 'entityId');
    const projectId = await inspections.projectOf(scope, inspectionId);
    if (!projectId) throw new AppError('inspection.not_found');
    return { inspectionId, projectId };
  }

  /** `quality.recordResponses`: the REST "save answers" call queued offline. Answers never conflict by version. */
  const recordResponses: SyncCommand = {
    name: 'quality.recordResponses',
    module: 'quality',
    async run(scope, m) {
      const { inspectionId, projectId } = await target(scope, m.entityId);
      const d = await inspections.recordResponses(
        scope,
        projectId,
        inspectionId,
        parseResponses(m.payload),
      );
      return { version: d.inspection.version };
    },
    current,
  };

  /** `quality.submit`: sign and submit, against the version the inspector last saw. */
  const submit: SyncCommand = {
    name: 'quality.submit',
    module: 'quality',
    async run(scope, m) {
      if (m.baseVersion === null)
        throw new AppError('validation_failed', 'A submit needs the version it was made against.', [
          { path: 'baseVersion', message: 'Required' },
        ]);
      const { inspectionId, projectId } = await target(scope, m.entityId);
      const name = m.payload.signedByName;
      if (typeof name !== 'string' || name.trim() === '' || name.length > 200)
        throw invalid('payload/signedByName', 'Name the signer');
      const d = await inspections.submit(scope, projectId, inspectionId, m.baseVersion, {
        signedByName: name,
        ...(m.payload.signatureFileId !== undefined
          ? { signatureFileId: id('file', m.payload.signatureFileId, 'payload/signatureFileId') }
          : {}),
      });
      return { version: d.inspection.version };
    },
    current,
  };

  return { syncSource, syncCommands: [recordResponses, submit] };
}

export function createQualityModule(services: KernelServices, deps: QualityDeps) {
  const inspections = createInspectionService(deps);
  const observations = createObservationService(deps);
  return {
    definition: defineModule({ name: 'quality', permissions: QUALITY_PERMISSIONS }),
    routes: qualityRoutes(services.database, inspections, observations),
    api: {
      /** What the mobile pull reads (modules/sync) and what a device may queue offline and push. */
      ...syncPieces(inspections),
    },
  };
}

export type QualityModule = ReturnType<typeof createQualityModule>;
