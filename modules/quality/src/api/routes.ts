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
import type { ActionPlanService } from '../application/action-plans';
import type { InspectionService } from '../application/inspections';
import type { ObservationFields, ObservationService } from '../application/observations';
import {
  toActionPlanDetail,
  toActionPlanDto,
  toActionPlanTemplateDto,
  toInspectionDetail,
  toInspectionDto,
  toObservationDto,
  toTemplateDetail,
  toTemplateDto,
} from './mappers';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};
const notFound = (kind: IdKind, value: string, code: string) => {
  const id = decodeId(kind, value);
  if (!id) throw new AppError(code as 'not_found');
  return id;
};

const project = (p: { projectId: string }) => notFound('project', p.projectId, 'project.not_found');

type ObservationBody = Omit<ObservationFields, 'assigneeCompanyId' | 'swmsId' | 'fileIds'> & {
  assigneeCompanyId?: string | null;
  swmsId?: string | null;
  fileIds?: string[];
};

type PlanItemBody = {
  title: string;
  description?: string;
  assigneeCompanyId?: string;
  dueDate?: string;
};

function planItem(b: PlanItemBody, path: string) {
  return {
    title: b.title,
    ...(b.description !== undefined ? { description: b.description } : {}),
    ...(b.assigneeCompanyId
      ? { assigneeCompanyId: ref('company', b.assigneeCompanyId, `${path}/assigneeCompanyId`) }
      : {}),
    ...(b.dueDate ? { dueDate: b.dueDate } : {}),
  };
}

function observationFields(b: ObservationBody): ObservationFields {
  const out: ObservationFields = {};
  if (b.type !== undefined) out.type = b.type;
  if (b.hazard !== undefined) out.hazard = b.hazard;
  if (b.description !== undefined) out.description = b.description;
  if (b.location !== undefined) out.location = b.location;
  if (b.priority !== undefined) out.priority = b.priority;
  if (b.dueDate !== undefined) out.dueDate = b.dueDate;
  if (b.assigneeCompanyId !== undefined)
    out.assigneeCompanyId =
      b.assigneeCompanyId === null
        ? null
        : ref('company', b.assigneeCompanyId, 'assigneeCompanyId');
  if (b.swmsId !== undefined)
    out.swmsId = b.swmsId === null ? null : ref('swms', b.swmsId, 'swmsId');
  if (b.fileIds !== undefined)
    out.fileIds = b.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`));
  return out;
}

export function qualityRoutes(
  database: Database,
  inspections: InspectionService,
  observations: ObservationService,
  actionPlans: ActionPlanService,
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const templateId = (p: { templateId: string }) =>
    notFound('inspectionTemplate', p.templateId, 'inspection_template.not_found');
  const inspectionId = (p: { inspectionId: string }) =>
    notFound('inspection', p.inspectionId, 'inspection.not_found');
  const planId = (p: { planId: string }) =>
    notFound('actionPlan', p.planId, 'action_plan.not_found');
  const itemId = (p: { itemId: string }) =>
    notFound('actionPlanItem', p.itemId, 'action_plan.item_not_found');
  const okPlan = (status: number, d: Awaited<ReturnType<ActionPlanService['detail']>>) => ({
    status,
    body: toActionPlanDetail(d),
    headers: { etag: etag(d.plan.version) },
  });
  const observationId = (p: { observationId: string }) =>
    notFound('observation', p.observationId, 'observation.not_found');

  const okInspection = (status: number, d: Awaited<ReturnType<InspectionService['detail']>>) => ({
    status,
    body: toInspectionDetail(d),
    headers: { etag: etag(d.inspection.version) },
  });
  const okObservation = (status: number, d: Awaited<ReturnType<ObservationService['detail']>>) => ({
    status,
    body: toObservationDto(d.observation, d.viewer, d.caps),
    headers: { etag: etag(d.observation.version) },
  });

  return defineRoutes({
    listInspectionTemplates: async (input) => {
      const rows = await read(input, (s) =>
        inspections.listTemplates(
          s,
          project(input.params),
          input.query.published ? input.query.published === 'true' : undefined,
        ),
      );
      return { status: 200, body: { data: rows.map(toTemplateDto) } };
    },
    createInspectionTemplate: async (input) => ({
      status: 201,
      body: toTemplateDetail(
        await tx(input, (s) => inspections.createTemplate(s, project(input.params), input.body)),
      ),
    }),
    getInspectionTemplate: async (input) => ({
      status: 200,
      body: toTemplateDetail(
        await read(input, (s) =>
          inspections.templateDetail(s, project(input.params), templateId(input.params)),
        ),
      ),
    }),
    updateInspectionTemplate: async (input) => ({
      status: 200,
      body: toTemplateDetail(
        await tx(input, (s) =>
          inspections.updateTemplate(
            s,
            project(input.params),
            templateId(input.params),
            input.body,
          ),
        ),
      ),
    }),
    publishInspectionTemplate: async (input) => ({
      status: 200,
      body: toTemplateDetail(
        await tx(input, (s) =>
          inspections.publishTemplate(s, project(input.params), templateId(input.params)),
        ),
      ),
    }),
    newInspectionTemplateVersion: async (input) => ({
      status: 201,
      body: toTemplateDetail(
        await tx(input, (s) =>
          inspections.newTemplateVersion(s, project(input.params), templateId(input.params)),
        ),
      ),
    }),
    listInspections: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        inspections.list(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          ...(q.templateId
            ? { templateId: ref('inspectionTemplate', q.templateId, 'templateId') }
            : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toInspectionDto), nextCursor: page.nextCursor },
      };
    },
    createInspection: async (input) =>
      okInspection(
        201,
        await tx(input, (s) =>
          inspections.create(s, project(input.params), {
            templateId: ref('inspectionTemplate', input.body.templateId, 'templateId'),
            ...(input.body.title ? { title: input.body.title } : {}),
            ...(input.body.location ? { location: input.body.location } : {}),
            ...(input.body.scheduledFor ? { scheduledFor: input.body.scheduledFor } : {}),
            ...(input.body.inspectorId
              ? { inspectorId: ref('user', input.body.inspectorId, 'inspectorId') }
              : {}),
          }),
        ),
      ),
    getInspection: async (input) =>
      okInspection(
        200,
        await read(input, (s) =>
          inspections.detail(s, project(input.params), inspectionId(input.params)),
        ),
      ),
    recordInspectionResponses: async (input) =>
      okInspection(
        200,
        await tx(input, (s) =>
          inspections.recordResponses(
            s,
            project(input.params),
            inspectionId(input.params),
            input.body.responses.map((r, n) => ({
              templateItemId: ref(
                'inspectionItem',
                r.templateItemId,
                `responses/${n}/templateItemId`,
              ),
              ...(r.value !== undefined ? { value: r.value } : {}),
              ...(r.result ? { result: r.result } : {}),
              ...(r.note !== undefined ? { note: r.note } : {}),
              ...(r.fileIds
                ? {
                    fileIds: r.fileIds.map((f, i) => ref('file', f, `responses/${n}/fileIds/${i}`)),
                  }
                : {}),
            })),
          ),
        ),
      ),
    submitInspection: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okInspection(
        200,
        await tx(input, (s) =>
          inspections.submit(s, project(input.params), inspectionId(input.params), expected, {
            signedByName: input.body.signedByName,
            ...(input.body.signatureFileId
              ? { signatureFileId: ref('file', input.body.signatureFileId, 'signatureFileId') }
              : {}),
          }),
        ),
      );
    },
    closeInspection: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okInspection(
        200,
        await tx(input, (s) =>
          inspections.close(s, project(input.params), inspectionId(input.params), expected),
        ),
      );
    },
    listObservations: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        observations.list(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          ...(q.type ? { type: q.type } : {}),
          ...(q.priority ? { priority: q.priority } : {}),
          ...(q.assigneeCompanyId
            ? { assigneeCompanyId: ref('company', q.assigneeCompanyId, 'assigneeCompanyId') }
            : {}),
          ...(q.overdue ? { overdue: q.overdue === 'true' } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: {
          data: page.data.map((o) => toObservationDto(o, page.viewer, page.caps)),
          nextCursor: page.nextCursor,
        },
      };
    },
    createObservation: async (input) =>
      okObservation(
        201,
        await tx(input, (s) =>
          observations.create(s, project(input.params), {
            ...observationFields(input.body),
            type: input.body.type,
            description: input.body.description,
          }),
        ),
      ),
    getObservation: async (input) =>
      okObservation(
        200,
        await read(input, (s) =>
          observations.detail(s, project(input.params), observationId(input.params)),
        ),
      ),
    updateObservation: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okObservation(
        200,
        await tx(input, (s) =>
          observations.update(
            s,
            project(input.params),
            observationId(input.params),
            expected,
            observationFields(input.body),
          ),
        ),
      );
    },
    transitionObservation: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      return okObservation(
        200,
        await tx(input, (s) =>
          observations.transition(s, project(input.params), observationId(input.params), expected, {
            action: b.action,
            ...(b.reason ? { reason: b.reason } : {}),
            ...(b.fileIds
              ? { fileIds: b.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`)) }
              : {}),
            ...(b.swmsId ? { swmsId: ref('swms', b.swmsId, 'swmsId') } : {}),
          }),
        ),
      );
    },

    listActionPlans: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        actionPlans.list(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toActionPlanDto), nextCursor: page.nextCursor },
      };
    },
    createActionPlan: async (input) => {
      const b = input.body;
      return okPlan(
        201,
        await tx(input, (s) =>
          actionPlans.create(s, project(input.params), {
            title: b.title,
            ...(b.description !== undefined ? { description: b.description } : {}),
            ...(b.dueDate ? { dueDate: b.dueDate } : {}),
            ...(b.templateId
              ? { templateId: ref('actionPlanTemplate', b.templateId, 'templateId') }
              : {}),
            ...(b.sourceType && b.sourceId
              ? {
                  sourceType: b.sourceType,
                  sourceId: ref(
                    b.sourceType === 'observation' ? 'observation' : 'inspection',
                    b.sourceId,
                    'sourceId',
                  ),
                }
              : b.sourceType || b.sourceId
                ? { sourceType: b.sourceType!, sourceId: b.sourceId! }
                : {}),
            ...(b.items ? { items: b.items.map((i, n) => planItem(i, `items/${n}`)) } : {}),
          }),
        ),
      );
    },
    getActionPlan: async (input) =>
      okPlan(
        200,
        await read(input, (s) =>
          actionPlans.detail(s, project(input.params), planId(input.params)),
        ),
      ),
    updateActionPlan: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okPlan(
        200,
        await tx(input, (s) =>
          actionPlans.update(s, project(input.params), planId(input.params), expected, input.body),
        ),
      );
    },
    addActionPlanItem: async (input) =>
      okPlan(
        201,
        await tx(input, (s) =>
          actionPlans.addItem(
            s,
            project(input.params),
            planId(input.params),
            planItem(input.body, ''),
          ),
        ),
      ),
    updateActionPlanItem: async (input) => {
      const b = input.body;
      return okPlan(
        200,
        await tx(input, (s) =>
          actionPlans.updateItem(
            s,
            project(input.params),
            planId(input.params),
            itemId(input.params),
            {
              ...(b.title !== undefined ? { title: b.title } : {}),
              ...(b.description !== undefined ? { description: b.description } : {}),
              ...(b.assigneeCompanyId !== undefined
                ? {
                    assigneeCompanyId:
                      b.assigneeCompanyId === null
                        ? null
                        : ref('company', b.assigneeCompanyId, 'assigneeCompanyId'),
                  }
                : {}),
              ...(b.dueDate !== undefined ? { dueDate: b.dueDate } : {}),
              ...(b.status !== undefined ? { status: b.status } : {}),
              ...(b.note !== undefined ? { note: b.note } : {}),
            },
          ),
        ),
      );
    },
    saveActionPlanAsTemplate: async (input) => ({
      status: 201,
      body: toActionPlanTemplateDto(
        await tx(input, (s) =>
          actionPlans.saveAsTemplate(
            s,
            project(input.params),
            planId(input.params),
            input.body.name,
          ),
        ),
      ),
    }),
    listActionPlanTemplates: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => actionPlans.listTemplates(s, project(input.params)))).map(
          toActionPlanTemplateDto,
        ),
      },
    }),
    createActionPlanTemplate: async (input) => ({
      status: 201,
      body: toActionPlanTemplateDto(
        await tx(input, (s) =>
          actionPlans.createTemplate(s, project(input.params), {
            name: input.body.name,
            ...(input.body.description !== undefined
              ? { description: input.body.description }
              : {}),
            items: input.body.items,
          }),
        ),
      ),
    }),
  });
}
