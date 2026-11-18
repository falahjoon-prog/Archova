import { decodeId, encodeId, type IdKind } from '@archova/domain';
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
import type { CarbonService } from '../application/carbon';
import type { WasteService } from '../application/waste';
import type { ConditionFields, ConditionService } from '../application/conditions';
import type { MonitoringService, PointFields } from '../application/monitoring';
import type { DocumentFields, RegisterService } from '../application/register';
import {
  toConditionDto,
  toDocumentDto,
  toEventDto,
  toPlanDto,
  toCarbonEntryDto,
  toCarbonSummaryDto,
  toDocketDto,
  toPointDto,
  toReadingDto,
  toSummaryDto,
  toWasteSummaryDto,
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

type ConditionBody = Omit<
  ConditionFields,
  'responsibleCompanyId' | 'responsibleUserId' | 'fileIds'
> & {
  responsibleCompanyId?: string | null;
  responsibleUserId?: string | null;
  fileIds?: string[];
};

function conditionFields(b: ConditionBody): ConditionFields {
  const out: ConditionFields = {};
  if (b.title !== undefined) out.title = b.title;
  if (b.requirement !== undefined) out.requirement = b.requirement;
  if (b.category !== undefined) out.category = b.category;
  if (b.source !== undefined) out.source = b.source;
  if (b.sourceReference !== undefined) out.sourceReference = b.sourceReference;
  if (b.frequency !== undefined) out.frequency = b.frequency;
  if (b.dueDate !== undefined) out.dueDate = b.dueDate;
  if (b.responsibleCompanyId !== undefined)
    out.responsibleCompanyId =
      b.responsibleCompanyId === null
        ? null
        : ref('company', b.responsibleCompanyId, 'responsibleCompanyId');
  if (b.responsibleUserId !== undefined)
    out.responsibleUserId =
      b.responsibleUserId === null ? null : ref('user', b.responsibleUserId, 'responsibleUserId');
  if (b.fileIds !== undefined)
    out.fileIds = b.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`));
  return out;
}

function documentFields(b: Omit<DocumentFields, 'fileId'> & { fileId?: string }): DocumentFields {
  const out: DocumentFields = {};
  if (b.title !== undefined) out.title = b.title;
  if (b.docType !== undefined) out.docType = b.docType;
  if (b.reference !== undefined) out.reference = b.reference;
  if (b.issuedOn !== undefined) out.issuedOn = b.issuedOn;
  if (b.expiresOn !== undefined) out.expiresOn = b.expiresOn;
  if (b.fileId !== undefined) out.fileId = ref('file', b.fileId, 'fileId');
  return out;
}

export function environmentRoutes(
  database: Database,
  conditions: ConditionService,
  register: RegisterService,
  monitoring: MonitoringService,
  waste: WasteService,
  carbon: CarbonService,
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const conditionId = (p: { conditionId: string }) =>
    notFound('environmentCondition', p.conditionId, 'environment.condition_not_found');
  const documentId = (p: { environmentDocumentId: string }) =>
    notFound('environmentDocument', p.environmentDocumentId, 'environment.document_not_found');

  const okCondition = (status: number, d: Awaited<ReturnType<ConditionService['detail']>>) => ({
    status,
    body: { condition: toConditionDto(d.condition), events: d.events.map(toEventDto) },
    headers: { etag: etag(d.condition.version) },
  });
  const okPlan = (status: number, p: Parameters<typeof toPlanDto>[0]) => ({
    status,
    body: toPlanDto(p),
    headers: { etag: etag(p.version) },
  });
  const okDocument = (status: number, d: Parameters<typeof toDocumentDto>[0]) => ({
    status,
    body: toDocumentDto(d),
    headers: { etag: etag(d.version) },
  });

  const docketId = (p: { wasteDocketId: string }) =>
    notFound('wasteDocket', p.wasteDocketId, 'environment.docket_not_found');
  const carbonId = (p: { carbonEntryId: string }) =>
    notFound('carbonEntry', p.carbonEntryId, 'environment.carbon_entry_not_found');
  const pointId = (p: { pointId: string }) =>
    notFound('monitoringPoint', p.pointId, 'environment.point_not_found');
  const readingId = (p: { readingId: string }) =>
    notFound('environmentReading', p.readingId, 'environment.reading_not_found');

  function pointFields(b: Omit<PointFields, 'conditionId'> & { conditionId?: string | null }) {
    const out: PointFields = {};
    if (b.name !== undefined) out.name = b.name;
    if (b.parameter !== undefined) out.parameter = b.parameter;
    if (b.unit !== undefined) out.unit = b.unit;
    if (b.location !== undefined) out.location = b.location;
    if (b.minLimit !== undefined) out.minLimit = b.minLimit;
    if (b.maxLimit !== undefined) out.maxLimit = b.maxLimit;
    if (b.warnMargin !== undefined) out.warnMargin = b.warnMargin;
    if (b.frequency !== undefined) out.frequency = b.frequency;
    if (b.active !== undefined) out.active = b.active;
    if (b.conditionId !== undefined)
      out.conditionId =
        b.conditionId === null ? null : ref('environmentCondition', b.conditionId, 'conditionId');
    return out;
  }
  const okPoint = (status: number, v: Parameters<typeof toPointDto>[0]) => ({
    status,
    body: toPointDto(v),
    headers: { etag: etag(v.point.version) },
  });

  return defineRoutes({
    getEnvironmentSummary: async (input) => ({
      status: 200,
      body: toSummaryDto(await read(input, (s) => register.summary(s, project(input.params)))),
    }),
    getEnvironmentPlan: async (input) => {
      const plan = await read(input, (s) => register.getPlan(s, project(input.params)));
      return { status: 200, body: { plan: plan ? toPlanDto(plan) : null } };
    },
    createEnvironmentPlan: async (input) =>
      okPlan(
        201,
        await tx(input, (s) => register.upsertPlan(s, project(input.params), null, input.body)),
      ),
    updateEnvironmentPlan: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okPlan(
        200,
        await tx(input, (s) => register.upsertPlan(s, project(input.params), expected, input.body)),
      );
    },
    approveEnvironmentPlan: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okPlan(
        200,
        await tx(input, (s) => register.approvePlan(s, project(input.params), expected)),
      );
    },
    listEnvironmentConditions: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        conditions.list(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          ...(q.category ? { category: q.category } : {}),
          ...(q.source ? { source: q.source } : {}),
          ...(q.overdue ? { overdue: q.overdue === 'true' } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toConditionDto), nextCursor: page.nextCursor },
      };
    },
    createEnvironmentCondition: async (input) =>
      okCondition(
        201,
        await tx(input, (s) =>
          conditions.create(s, project(input.params), {
            ...conditionFields(input.body),
            title: input.body.title,
            category: input.body.category,
          }),
        ),
      ),
    applyEnvironmentStarterPack: async (input) => {
      const r = await tx(input, (s) => conditions.applyStarterPack(s, project(input.params)));
      return { status: 201, body: { created: r.created.map(toConditionDto), skipped: r.skipped } };
    },
    getEnvironmentCondition: async (input) =>
      okCondition(
        200,
        await read(input, (s) =>
          conditions.detail(s, project(input.params), conditionId(input.params)),
        ),
      ),
    updateEnvironmentCondition: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okCondition(
        200,
        await tx(input, (s) =>
          conditions.update(
            s,
            project(input.params),
            conditionId(input.params),
            expected,
            conditionFields(input.body),
          ),
        ),
      );
    },
    transitionEnvironmentCondition: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      return okCondition(
        200,
        await tx(input, (s) =>
          conditions.transition(s, project(input.params), conditionId(input.params), expected, {
            action: b.action,
            ...(b.note !== undefined ? { note: b.note } : {}),
            ...(b.fileIds
              ? { fileIds: b.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`)) }
              : {}),
          }),
        ),
      );
    },
    listEnvironmentDocuments: async (input) => {
      const rows = await read(input, (s) =>
        register.listDocuments(s, project(input.params), input.query.docType),
      );
      return { status: 200, body: { data: rows.map(toDocumentDto) } };
    },
    createEnvironmentDocument: async (input) =>
      okDocument(
        201,
        await tx(input, (s) =>
          register.createDocument(s, project(input.params), {
            ...documentFields(input.body),
            title: input.body.title,
            docType: input.body.docType,
            fileId: ref('file', input.body.fileId, 'fileId'),
          }),
        ),
      ),
    updateEnvironmentDocument: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okDocument(
        200,
        await tx(input, (s) =>
          register.updateDocument(
            s,
            project(input.params),
            documentId(input.params),
            expected,
            documentFields(input.body),
          ),
        ),
      );
    },
    deleteEnvironmentDocument: async (input) => {
      await tx(input, (s) =>
        register.deleteDocument(s, project(input.params), documentId(input.params)),
      );
      return { status: 204 };
    },
    listMonitoringPoints: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => monitoring.listPoints(s, project(input.params)))).map(
          toPointDto,
        ),
      },
    }),
    createMonitoringPoint: async (input) =>
      okPoint(
        201,
        await tx(input, (s) =>
          monitoring.createPoint(s, project(input.params), {
            ...pointFields(input.body),
            name: input.body.name,
            parameter: input.body.parameter,
            unit: input.body.unit,
          }),
        ),
      ),
    updateMonitoringPoint: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okPoint(
        200,
        await tx(input, (s) =>
          monitoring.updatePoint(
            s,
            project(input.params),
            pointId(input.params),
            expected,
            pointFields(input.body),
          ),
        ),
      );
    },
    listPointReadings: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        monitoring.listPointReadings(s, project(input.params), pointId(input.params), {
          ...(q.status ? { status: q.status } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map((r) => toReadingDto(r)), nextCursor: page.nextCursor },
      };
    },
    logReading: async (input) => {
      const b = input.body;
      const r = await tx(input, (s) =>
        monitoring.logReading(s, project(input.params), pointId(input.params), {
          value: b.value,
          ...(b.takenAt ? { takenAt: new Date(b.takenAt) } : {}),
          ...(b.note ? { note: b.note } : {}),
          ...(b.fileIds
            ? { fileIds: b.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`)) }
            : {}),
        }),
      );
      return { status: 201, body: toReadingDto(r.reading) };
    },
    listEnvironmentReadings: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        monitoring.listReadings(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          ...(q.open ? { open: q.open === 'true' } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: {
          data: page.data.map((r) => toReadingDto(r, { pointName: r.pointName, unit: r.unit })),
          nextCursor: page.nextCursor,
        },
      };
    },
    listWasteDockets: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        waste.listDockets(s, project(input.params), {
          ...(q.wasteType ? { wasteType: q.wasteType } : {}),
          ...(q.destination ? { destination: q.destination } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toDocketDto), nextCursor: page.nextCursor },
      };
    },
    createWasteDocket: async (input) => {
      const b = input.body;
      const d = await tx(input, (s) =>
        waste.createDocket(s, project(input.params), {
          docketDate: b.docketDate,
          wasteType: b.wasteType,
          destination: b.destination,
          tonnes: b.tonnes,
          ...(b.docketNumber ? { docketNumber: b.docketNumber } : {}),
          ...(b.contractor ? { contractor: b.contractor } : {}),
          ...(b.facility ? { facility: b.facility } : {}),
          ...(b.note ? { note: b.note } : {}),
          ...(b.fileIds
            ? { fileIds: b.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`)) }
            : {}),
        }),
      );
      return { status: 201, body: toDocketDto(d) };
    },
    getWasteSummary: async (input) => ({
      status: 200,
      body: toWasteSummaryDto(await read(input, (s) => waste.overview(s, project(input.params)))),
    }),
    deleteWasteDocket: async (input) => {
      await tx(input, (s) => waste.deleteDocket(s, project(input.params), docketId(input.params)));
      return { status: 204 };
    },
    listCarbonEntries: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        carbon.listEntries(s, project(input.params), {
          ...(q.source ? { source: q.source } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toCarbonEntryDto), nextCursor: page.nextCursor },
      };
    },
    createCarbonEntry: async (input) => {
      const b = input.body;
      const e = await tx(input, (s) =>
        carbon.createEntry(s, project(input.params), {
          entryDate: b.entryDate,
          source: b.source,
          quantity: b.quantity,
          ...(b.factor !== undefined ? { factor: b.factor } : {}),
          ...(b.description ? { description: b.description } : {}),
          ...(b.note ? { note: b.note } : {}),
        }),
      );
      return { status: 201, body: toCarbonEntryDto(e) };
    },
    getCarbonSummary: async (input) => ({
      status: 200,
      body: toCarbonSummaryDto(await read(input, (s) => carbon.overview(s, project(input.params)))),
    }),
    deleteCarbonEntry: async (input) => {
      await tx(input, (s) => carbon.deleteEntry(s, project(input.params), carbonId(input.params)));
      return { status: 204 };
    },
    respondToReading: async (input) => {
      const r = await tx(input, (s) =>
        monitoring.respond(s, project(input.params), readingId(input.params), {
          note: input.body.note,
          raiseIncident: input.body.raiseIncident ?? false,
        }),
      );
      return {
        status: 200,
        body: {
          reading: toReadingDto(r.reading),
          incidentId: r.incident ? encodeId('incident', r.incident.id) : null,
          incidentNumber: r.incident?.number ?? null,
        },
      };
    },
  });
}
