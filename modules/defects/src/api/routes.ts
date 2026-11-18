import { decodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { DefectFields, DefectService } from '../application/defects';
import { toDefectDetail, toDefectDto } from './mappers';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};

const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const defectId = (p: { defectId: string }) => {
  const id = decodeId('defect', p.defectId);
  if (!id) throw new AppError('defect.not_found');
  return id;
};

type FieldsBody = Omit<
  DefectFields,
  | 'assigneeCompanyId'
  | 'assigneeUserId'
  | 'assigneeUserIds'
  | 'managerUserId'
  | 'finalApproverUserId'
  | 'distributionUserIds'
  | 'approverDelegateUserId'
  | 'pin'
  | 'warrantyItemId'
> & {
  assigneeCompanyId?: string | null;
  assigneeUserId?: string | null;
  assigneeUserIds?: string[];
  managerUserId?: string | null;
  finalApproverUserId?: string | null;
  distributionUserIds?: string[];
  approverDelegateUserId?: string | null;
  pin?: { drawingRevisionId: string; x: number; y: number };
  warrantyItemId?: string | null;
};

/** Request body → service fields, decoding prefixed ids and keeping "absent" distinct from "null". */
function fields(b: FieldsBody): DefectFields {
  const out: DefectFields = {};
  if (b.title !== undefined) out.title = b.title;
  if (b.description !== undefined) out.description = b.description;
  if (b.priority !== undefined) out.priority = b.priority;
  if (b.category !== undefined) out.category = b.category;
  if (b.trade !== undefined) out.trade = b.trade;
  if (b.stage !== undefined) out.stage = b.stage;
  if (b.dueDate !== undefined) out.dueDate = b.dueDate;
  if (b.assigneeCompanyId !== undefined)
    out.assigneeCompanyId =
      b.assigneeCompanyId === null
        ? null
        : ref('company', b.assigneeCompanyId, 'assigneeCompanyId');
  if (b.assigneeUserId !== undefined)
    out.assigneeUserId =
      b.assigneeUserId === null ? null : ref('user', b.assigneeUserId, 'assigneeUserId');
  if (b.warrantyItemId !== undefined)
    out.warrantyItemId =
      b.warrantyItemId === null ? null : ref('warrantyItem', b.warrantyItemId, 'warrantyItemId');
  if (b.assigneeUserIds !== undefined)
    out.assigneeUserIds = b.assigneeUserIds.map((u, i) => ref('user', u, `assigneeUserIds/${i}`));
  if (b.managerUserId !== undefined)
    out.managerUserId =
      b.managerUserId === null ? null : ref('user', b.managerUserId, 'managerUserId');
  if (b.finalApproverUserId !== undefined)
    out.finalApproverUserId =
      b.finalApproverUserId === null
        ? null
        : ref('user', b.finalApproverUserId, 'finalApproverUserId');
  if (b.distributionUserIds !== undefined)
    out.distributionUserIds = b.distributionUserIds.map((u, i) =>
      ref('user', u, `distributionUserIds/${i}`),
    );
  if (b.approverDelegateUserId !== undefined)
    out.approverDelegateUserId =
      b.approverDelegateUserId === null
        ? null
        : ref('user', b.approverDelegateUserId, 'approverDelegateUserId');
  if (b.approverDelegateFrom !== undefined) out.approverDelegateFrom = b.approverDelegateFrom;
  if (b.approverDelegateUntil !== undefined) out.approverDelegateUntil = b.approverDelegateUntil;
  if (b.requireCloseEvidence !== undefined) out.requireCloseEvidence = b.requireCloseEvidence;
  if (b.pin)
    out.pin = {
      ...b.pin,
      drawingRevisionId: ref('drawingRevision', b.pin.drawingRevisionId, 'pin/drawingRevisionId'),
    };
  return out;
}

export function defectsRoutes(database: Database, defects: DefectService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const ok = (status: number, x: Awaited<ReturnType<DefectService['detail']>>) => ({
    status,
    body: toDefectDetail(x),
    headers: { etag: etag(x.defect.version) },
  });

  return defineRoutes({
    listDefects: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        defects.list(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          ...(q.assigneeCompanyId
            ? { assigneeCompanyId: ref('company', q.assigneeCompanyId, 'assigneeCompanyId') }
            : {}),
          ...(q.stage ? { stage: q.stage } : {}),
          ...(q.priority ? { priority: q.priority } : {}),
          ...(q.trade ? { trade: q.trade } : {}),
          ...(q.overdue ? { overdue: q.overdue === 'true' } : {}),
          ...(q.drawingRevisionId
            ? {
                drawingRevisionId: ref('drawingRevision', q.drawingRevisionId, 'drawingRevisionId'),
              }
            : {}),
          ...(q.warrantyItemId
            ? { warrantyItemId: ref('warrantyItem', q.warrantyItemId, 'warrantyItemId') }
            : {}),
          ...(q.q ? { q: q.q } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: {
          data: page.data.map((d) => toDefectDto(d, page.viewer)),
          nextCursor: page.nextCursor,
        },
      };
    },
    createDefect: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          defects.create(s, project(input.params), {
            ...fields(input.body),
            title: input.body.title,
            ...(input.body.aiSuggestionId
              ? { aiSuggestionId: ref('aiSuggestion', input.body.aiSuggestionId, 'aiSuggestionId') }
              : {}),
          }),
        ),
      ),
    getDefect: async (input) =>
      ok(
        200,
        await read(input, (s) => defects.detail(s, project(input.params), defectId(input.params))),
      ),
    updateDefect: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          defects.update(
            s,
            project(input.params),
            defectId(input.params),
            expected,
            fields(input.body),
          ),
        ),
      );
    },
    transitionDefect: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      return ok(
        200,
        await tx(input, (s) =>
          defects.transition(s, project(input.params), defectId(input.params), expected, {
            action: b.action,
            ...(b.reason ? { reason: b.reason } : {}),
            ...(b.fileIds
              ? { fileIds: b.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`)) }
              : {}),
            ...(b.assigneeCompanyId
              ? { assigneeCompanyId: ref('company', b.assigneeCompanyId, 'assigneeCompanyId') }
              : {}),
          }),
        ),
      );
    },
  });
}
