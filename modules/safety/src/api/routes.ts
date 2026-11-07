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
import type { SwmsFields, SwmsService } from '../application/swms';
import type { SwmsContent } from '../domain/swms';
import type { ActionInput, IncidentFields, IncidentService } from '../application/incidents';
import {
  toActionDto,
  toActionFromSource,
  toIncidentDetail,
  toIncidentListDto,
  toSwmsDetail,
  toSwmsDto,
} from './mappers';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};

type Body = {
  title?: string;
  companyId?: string | null;
  highRiskWorkCategories?: string[];
  content?: SwmsContent;
  fileId?: string | null;
  expiresOn?: string | null;
};

function fields(b: Body): SwmsFields {
  const out: SwmsFields = {};
  if (b.title !== undefined) out.title = b.title;
  if (b.companyId !== undefined)
    out.companyId = b.companyId === null ? null : ref('company', b.companyId, 'companyId');
  if (b.highRiskWorkCategories !== undefined) out.highRiskWorkCategories = b.highRiskWorkCategories;
  if (b.content !== undefined) out.content = b.content;
  if (b.fileId !== undefined)
    out.fileId = b.fileId === null ? null : ref('file', b.fileId, 'fileId');
  if (b.expiresOn !== undefined) out.expiresOn = b.expiresOn;
  return out;
}

type IncidentBody = {
  title?: string;
  type?: IncidentFields['type'];
  severity?: IncidentFields['severity'];
  occurredAt?: string;
  location?: string | null;
  description?: string;
  immediateActions?: string | null;
  isNotifiable?: boolean;
  notifiableClass?: IncidentFields['notifiableClass'];
  regulatorNotifiedAt?: string | null;
  writtenNoticeRequestedAt?: string | null;
  rootCause?: IncidentFields['rootCause'];
  people?: {
    personName: string;
    companyId?: string;
    role: 'injured' | 'witness' | 'involved';
    injury?: Record<string, unknown>;
  }[];
};

const dateOrNull = (v: string | null) => (v === null ? null : new Date(v));

function incidentFields(b: IncidentBody): IncidentFields {
  const out: IncidentFields = {};
  if (b.title !== undefined) out.title = b.title;
  if (b.type !== undefined) out.type = b.type;
  if (b.severity !== undefined) out.severity = b.severity;
  if (b.occurredAt !== undefined) out.occurredAt = new Date(b.occurredAt);
  if (b.location !== undefined) out.location = b.location;
  if (b.description !== undefined) out.description = b.description;
  if (b.immediateActions !== undefined) out.immediateActions = b.immediateActions;
  if (b.isNotifiable !== undefined) out.isNotifiable = b.isNotifiable;
  if (b.notifiableClass !== undefined) out.notifiableClass = b.notifiableClass;
  if (b.regulatorNotifiedAt !== undefined)
    out.regulatorNotifiedAt = dateOrNull(b.regulatorNotifiedAt);
  if (b.writtenNoticeRequestedAt !== undefined)
    out.writtenNoticeRequestedAt = dateOrNull(b.writtenNoticeRequestedAt);
  if (b.rootCause !== undefined) out.rootCause = b.rootCause;
  if (b.people !== undefined)
    out.people = b.people.map((p) => ({
      personName: p.personName,
      role: p.role,
      companyId: p.companyId ? ref('company', p.companyId, 'people') : null,
      injury: p.injury ?? null,
    }));
  return out;
}

type ActionBody = {
  title?: string;
  description?: string | null;
  assigneeCompanyId?: string | null;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  source?: { type: 'inspection' | 'observation'; id: string } | null;
  status?: ActionInput['status'];
};

function actionFields(b: ActionBody): ActionInput {
  const out: ActionInput = {};
  if (b.title !== undefined) out.title = b.title;
  if (b.description !== undefined) out.description = b.description;
  if (b.assigneeCompanyId !== undefined)
    out.assigneeCompanyId =
      b.assigneeCompanyId === null
        ? null
        : ref('company', b.assigneeCompanyId, 'assigneeCompanyId');
  if (b.assigneeUserId !== undefined)
    out.assigneeUserId =
      b.assigneeUserId === null ? null : ref('user', b.assigneeUserId, 'assigneeUserId');
  if (b.dueDate !== undefined) out.dueDate = b.dueDate;
  if (b.source !== undefined)
    out.source =
      b.source === null
        ? null
        : { type: b.source.type, id: ref(b.source.type, b.source.id, 'source.id') };
  if (b.status !== undefined) out.status = b.status;
  return out;
}

export function safetyRoutes(database: Database, swms: SwmsService, incidents: IncidentService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const project = (p: { projectId: string }) => {
    const id = decodeId('project', p.projectId);
    if (!id) throw new AppError('project.not_found');
    return id;
  };
  const swmsId = (p: { swmsId: string }) => {
    const id = decodeId('swms', p.swmsId);
    if (!id) throw new AppError('swms.not_found');
    return id;
  };
  const ok = (status: number, d: Awaited<ReturnType<SwmsService['detail']>>) => ({
    status,
    body: toSwmsDetail(d),
    headers: { etag: etag(d.swms.version) },
  });

  const incidentId = (p: { incidentId: string }) => {
    const id = decodeId('incident', p.incidentId);
    if (!id) throw new AppError('incident.not_found');
    return id;
  };
  const incidentOk = (status: number, d: Awaited<ReturnType<IncidentService['detail']>>) => ({
    status,
    body: toIncidentDetail(d),
    headers: { etag: etag(d.incident.version) },
  });

  return defineRoutes({
    listIncidentActionsFromSource: async (input) => {
      const type = input.query.sourceType;
      const rows = await read(input, (s) =>
        incidents.actionsFromSource(s, project(input.params), {
          type,
          id: ref(type, input.query.sourceId, 'sourceId'),
        }),
      );
      return { status: 200, body: { data: rows.map(toActionFromSource) } };
    },
    listIncidents: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        incidents.list(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          ...(q.type ? { type: q.type } : {}),
          ...(q.notifiable ? { notifiable: q.notifiable === 'true' } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toIncidentListDto), nextCursor: page.nextCursor },
      };
    },
    reportIncident: async (input) =>
      incidentOk(
        201,
        await tx(input, (s) =>
          incidents.create(s, project(input.params), {
            ...incidentFields(input.body),
            title: input.body.title,
            type: input.body.type,
            occurredAt: new Date(input.body.occurredAt),
          }),
        ),
      ),
    getIncident: async (input) =>
      incidentOk(
        200,
        await read(input, (s) =>
          incidents.detail(s, project(input.params), incidentId(input.params)),
        ),
      ),
    updateIncident: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return incidentOk(
        200,
        await tx(input, (s) =>
          incidents.update(
            s,
            project(input.params),
            incidentId(input.params),
            expected,
            incidentFields(input.body),
          ),
        ),
      );
    },
    transitionIncident: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return incidentOk(
        200,
        await tx(input, (s) =>
          incidents.transition(s, project(input.params), incidentId(input.params), expected, {
            action: input.body.action,
            ...(input.body.reason ? { reason: input.body.reason } : {}),
          }),
        ),
      );
    },
    addIncidentAction: async (input) =>
      incidentOk(
        201,
        await tx(input, (s) =>
          incidents.addAction(s, project(input.params), incidentId(input.params), {
            ...actionFields(input.body),
            title: input.body.title,
          }),
        ),
      ),
    updateIncidentAction: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const actionId = decodeId('incidentAction', input.params.actionId);
      if (!actionId) throw new AppError('incident.action_not_found');
      const a = await tx(input, (s) =>
        incidents.updateAction(
          s,
          project(input.params),
          incidentId(input.params),
          actionId,
          expected,
          actionFields(input.body),
        ),
      );
      return { status: 200, body: toActionDto(a), headers: { etag: etag(a.version) } };
    },
    listSwms: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        swms.list(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          ...(q.companyId ? { companyId: ref('company', q.companyId, 'companyId') } : {}),
          ...(q.category ? { category: q.category } : {}),
          ...(q.expired ? { expired: q.expired === 'true' } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toSwmsDto), nextCursor: page.nextCursor },
      };
    },
    createSwms: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          swms.create(s, project(input.params), {
            ...fields(input.body),
            title: input.body.title,
          }),
        ),
      ),
    getSwms: async (input) =>
      ok(
        200,
        await read(input, (s) => swms.detail(s, project(input.params), swmsId(input.params))),
      ),
    updateSwms: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          swms.update(s, project(input.params), swmsId(input.params), expected, fields(input.body)),
        ),
      );
    },
    checkSwms: async (input) => ({
      status: 200,
      body: await read(input, (s) => swms.check(s, project(input.params), swmsId(input.params))),
    }),
    transitionSwms: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      return ok(
        200,
        await tx(input, (s) =>
          swms.transition(s, project(input.params), swmsId(input.params), expected, {
            action: b.action,
            ...(b.reason ? { reason: b.reason } : {}),
            ...(b.confirmedUnderstandable !== undefined
              ? { confirmedUnderstandable: b.confirmedUnderstandable }
              : {}),
          }),
        ),
      );
    },
    acknowledgeSwms: async (input) =>
      ok(
        200,
        await tx(input, (s) =>
          swms.acknowledge(s, project(input.params), swmsId(input.params), {
            workerName: input.body.workerName,
            ...(input.body.language ? { language: input.body.language } : {}),
          }),
        ),
      ),
  });
}
