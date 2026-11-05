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
import { toInspectionDetail, toTemplateDetail } from './api/mappers';
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
      encodeId(
        entityType === 'observation'
          ? 'observation'
          : entityType === 'inspection_template'
            ? 'inspectionTemplate'
            : 'inspection',
        uuid,
      ),
    async load(scope, { projectId, entityType, ids }) {
      const out = new Map<string, { version: number; data: Record<string, unknown> }>();
      // Observations are online-only for now; their changes reach the device as deletes of nothing.
      if (!projectId) return out;
      if (entityType === 'inspection_template') {
        for (const d of await inspections.templatesAmong(scope, projectId, ids)) {
          const { template, items } = toTemplateDetail(d);
          out.set(d.template.id, {
            version: d.template.version,
            // Flat, like inspections: the device files the record by its `projectId`.
            data: { ...template, items } as unknown as Record<string, unknown>,
          });
        }
        return out;
      }
      if (entityType !== 'inspection') return out;
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
      const answers = parseResponses(m.payload);
      // An answer that does not mention photos leaves the item's photos as they are: the phone may have sent it
      // before a photo taken meanwhile reached the server, and must not wipe it.
      const held = await inspections.detail(scope, projectId, inspectionId);
      for (const a of answers) {
        if (a.fileIds === undefined)
          a.fileIds =
            held.responses.find((r) => r.templateItemId === a.templateItemId)?.fileIds ?? [];
      }
      const d = await inspections.recordResponses(scope, projectId, inspectionId, answers);
      return { version: d.inspection.version };
    },
    current,
  };

  /**
   * `quality.attachItemPhoto`: a photo taken on site for one checklist item. The phone queues it held until the
   * photo has uploaded, then fills in `fileId`. It adds the file to the item's answer and keeps the rest of the
   * answer as it is; a retry that finds the file already attached changes nothing.
   */
  const attachItemPhoto: SyncCommand = {
    name: 'quality.attachItemPhoto',
    module: 'quality',
    async run(scope, m) {
      const { inspectionId, projectId } = await target(scope, m.entityId);
      const itemId = id('inspectionItem', m.payload.templateItemId, 'payload/templateItemId');
      const fileId = id('file', m.payload.fileId, 'payload/fileId');
      const d = await inspections.detail(scope, projectId, inspectionId);
      const existing = d.responses.find((r) => r.templateItemId === itemId);
      const have = existing?.fileIds ?? [];
      if (have.includes(fileId)) return { version: d.inspection.version };
      if (have.length >= 20) throw invalid('payload/fileId', 'An item holds at most 20 photos');
      const next = await inspections.recordResponses(scope, projectId, inspectionId, [
        {
          templateItemId: itemId,
          ...(existing?.value !== null && existing?.value !== undefined
            ? { value: existing.value as string | number | boolean }
            : {}),
          ...(existing?.result ? { result: existing.result } : {}),
          ...(existing?.note ? { note: existing.note } : {}),
          fileIds: [...have, fileId],
        },
      ]);
      return { version: next.inspection.version };
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

  /**
   * `quality.startInspection`: the REST "start an inspection from a published checklist" call queued offline. The
   * device picks the inspection's id; the number is given by the server when this arrives.
   */
  const startInspection: SyncCommand = {
    name: 'quality.startInspection',
    module: 'quality',
    async run(scope, m) {
      const inspectionId = id('inspection', m.entityId, 'entityId');
      const p = m.payload;
      const templateId = id('inspectionTemplate', p.templateId, 'payload/templateId');
      const text = (v: unknown, path: string, max: number) => {
        if (v === undefined || v === null) return undefined;
        if (typeof v !== 'string' || v.length > max) throw invalid(path);
        return v.trim() === '' ? undefined : v;
      };
      const title = text(p.title, 'payload/title', 200);
      const location = text(p.location, 'payload/location', 200);
      const projectId = await inspections.templateProjectOf(scope, templateId);
      if (!projectId) throw new AppError('inspection_template.not_found');
      const d = await inspections.create(scope, projectId, {
        id: inspectionId,
        templateId,
        ...(title ? { title } : {}),
        ...(location ? { location } : {}),
      });
      return { version: d.inspection.version };
    },
    // A start has no earlier copy to conflict with.
    async current() {
      return null;
    },
  };

  return { syncSource, syncCommands: [startInspection, recordResponses, attachItemPhoto, submit] };
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
