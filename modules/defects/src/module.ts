import { DEFECT_ACTIONS, decodeId, encodeId } from '@archova/domain';
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
  const id = (
    kind: 'defect' | 'file' | 'company' | 'project' | 'drawingRevision',
    value: unknown,
    path: string,
  ) => {
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
  const makeTransition = (name: string, fixedAction?: string): SyncCommand => ({
    name,
    module: 'defects',
    // Worth an admin's look if the person lost access first (X38); a grant only queues it.
    drainable: true,
    async projectOf(scope, entityId) {
      const defectId = typeof entityId === 'string' ? decodeId('defect', entityId) : null;
      return defectId ? service.projectOf(scope, defectId) : null;
    },
    async run(scope, m) {
      const defectId = id('defect', m.entityId, 'entityId');
      if (m.baseVersion === null)
        throw new AppError(
          'validation_failed',
          'A transition needs the version it was made against.',
          [{ path: 'baseVersion', message: 'Required' }],
        );
      const p = m.payload;
      const action = fixedAction ?? p.action;
      if (typeof action !== 'string')
        throw new AppError('validation_failed', 'Name the action.', [
          { path: 'payload/action', message: 'Required' },
        ]);
      // The phone's per-action commands say `note`; `defects.transition` says `reason`.
      const reason = textField(fixedAction ? (p.note ?? p.reason) : p.reason, 'payload/reason');
      const fileIds = p.fileIds === undefined ? undefined : p.fileIds;
      if (fileIds !== undefined && !Array.isArray(fileIds)) throw invalid('payload/fileIds');
      const projectId = await service.projectOf(scope, defectId);
      if (!projectId) throw new AppError('defect.not_found');
      const detail = await service.transition(scope, projectId, defectId, m.baseVersion, {
        action: action as never,
        ...(reason ? { reason } : {}),
        ...(fileIds
          ? { fileIds: fileIds.map((f, i) => id('file', f, `payload/fileIds/${i}`)) }
          : {}),
        ...(p.assigneeCompanyId !== undefined
          ? { assigneeCompanyId: id('company', p.assigneeCompanyId, 'payload/assigneeCompanyId') }
          : {}),
        ...(m.late
          ? {
              lateNote: `Sent late by ${encodeId('user', m.late.userId)} (device time ${m.late.clientAt.toISOString()}, not verified; received ${m.late.receivedAt.toISOString()})`,
            }
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
  });
  const transitionCommand = makeTransition('defects.transition');
  /** `defects.markReadyForReview`, `defects.close`, ...: the phone queues one command per action (mobile 02 §2.4). */
  const actionCommands = DEFECT_ACTIONS.map((a) => makeTransition(`defects.${a}`, a));
  /**
   * `defects.create`: a defect raised on site, under the id the phone chose. It starts as a draft, as on the web; the
   * phone queues "issue" after it. The project is the phone's claim: the service checks the person holds create there.
   */
  const createCommand: SyncCommand = {
    name: 'defects.create',
    module: 'defects',
    async run(scope, m) {
      const defectId = id('defect', m.entityId, 'entityId');
      const p = m.payload;
      const projectId = id('project', p.projectId, 'payload/projectId');
      const title = textField(p.title, 'payload/title');
      if (!title?.trim())
        throw new AppError('validation_failed', 'Give the defect a title.', [
          { path: 'payload/title', message: 'Required' },
        ]);
      const description = textField(p.description, 'payload/description');
      const priority = textField(p.priority, 'payload/priority');
      const stage = textField(p.stage, 'payload/stage');
      const trade = textField(p.trade, 'payload/trade');
      const dueDate = textField(p.dueDate, 'payload/dueDate');
      const input: Parameters<typeof service.create>[2] = { id: defectId, title };
      if (description !== undefined) input.description = description;
      if (priority) input.priority = priority as never;
      if (stage) input.stage = stage as never;
      if (trade) input.trade = trade;
      if (dueDate) input.dueDate = dueDate;
      if (p.assigneeCompanyId)
        input.assigneeCompanyId = id('company', p.assigneeCompanyId, 'payload/assigneeCompanyId');
      if (p.drawingRevisionId) {
        const x = p.pinX;
        const y = p.pinY;
        if (typeof x !== 'number' || typeof y !== 'number') throw invalid('payload/pinX');
        input.pin = {
          drawingRevisionId: id(
            'drawingRevision',
            p.drawingRevisionId,
            'payload/drawingRevisionId',
          ),
          x,
          y,
        };
      }
      const created = await service.create(scope, projectId, input);
      return { version: created.defect.version };
    },
    current: transitionCommand.current,
  };
  /**
   * `defects.attachPhoto`: a photo taken on site for a defect. The phone queues it held until the upload has
   * finished, then fills in `fileId`; the step that needs the photo ("after" for ready for review) depends on it.
   */
  const attachPhotoCommand: SyncCommand = {
    name: 'defects.attachPhoto',
    module: 'defects',
    async projectOf(scope, entityId) {
      const defectId = typeof entityId === 'string' ? decodeId('defect', entityId) : null;
      return defectId ? service.projectOf(scope, defectId) : null;
    },
    async run(scope, m) {
      const defectId = id('defect', m.entityId, 'entityId');
      const fileId = id('file', m.payload.fileId, 'payload/fileId');
      const purpose = m.payload.purpose;
      if (purpose !== 'before' && purpose !== 'after')
        throw new AppError('validation_failed', 'Say whether it is a before or after photo.', [
          { path: 'payload/purpose', message: 'Expected before or after' },
        ]);
      const projectId = await service.projectOf(scope, defectId);
      if (!projectId) throw new AppError('defect.not_found');
      return service.attachPhoto(scope, projectId, defectId, fileId, purpose);
    },
    current: transitionCommand.current,
  };
  return {
    definition: defineModule({ name: 'defects', permissions: DEFECTS_PERMISSIONS }),
    routes: defectsRoutes(services.database, service),
    api: {
      /** Nova F5: live defects the caller can see near a point on a sheet, for duplicate checks. Called by `ai` only. */
      openNear: service.openNear,
      /** Meeting agenda (`meetings`): open defects the caller can see, grouped by trade. */
      openForMeeting: service.openForMeeting,
      /** Portfolio dashboard and report builder (`reporting`): counts and flat rows of the defects the caller can see. */
      portfolioCounts: service.portfolioCounts,
      /** Global search (`search`): defects the caller can see that match some words. */
      searchHits: service.searchHits,
      /** Related items (`links`): defects the caller can see among some ids. */
      linkSummaries: service.linkSummaries,
      reportRows: service.reportRows,
      /** Nova Ask: issued defects with their history notes, to index (one defect when `only` is given). Called by `ai` only. */
      aiSources: service.aiSources,
      /** Nova Ask: the scopes the caller holds for defects (builder staff only). */
      aiAccessScopes: service.aiAccessScopes,
      /** What the mobile pull reads (modules/sync). */
      syncSource,
      /** What a device may queue offline and push (modules/sync). */
      syncCommands: [createCommand, transitionCommand, ...actionCommands, attachPhotoCommand],
    },
  };
}

export type DefectsModule = ReturnType<typeof createDefectsModule>;
export type DefectsApi = DefectsModule['api'];
