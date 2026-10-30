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
import type { RfiFields, RfiService } from '../application/rfis';
import { toRfiActivity, toRfiDetail, toRfiDto } from './mappers';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};
const refs = (kind: IdKind, values: string[] | undefined, path: string) =>
  values?.map((v, i) => ref(kind, v, `${path}/${i}`));

const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const rfiId = (p: { rfiId: string }) => {
  const id = decodeId('rfi', p.rfiId);
  if (!id) throw new AppError('rfi.not_found');
  return id;
};

type FieldsBody = {
  subject?: string;
  question?: string;
  isPrivate?: boolean;
  managerId?: string | null;
  receivedFromCompanyId?: string;
  assigneeIds?: string[];
  distributionUserIds?: string[];
  distributionCompanyIds?: string[];
  dueDate?: string | null;
  costImpact?: 'yes' | 'no' | 'tbc' | null;
  costEstimate?: string | null;
  scheduleImpactDays?: number | null;
  delayDays?: number | null;
  specSection?: string | null;
  location?: string | null;
  pin?: { drawingRevisionId: string; x?: number; y?: number } | null;
};

/** Request body → service fields, decoding prefixed ids and keeping "absent" distinct from "null". */
function fields(b: FieldsBody): RfiFields {
  const out: RfiFields = {};
  if (b.subject !== undefined) out.subject = b.subject;
  if (b.question !== undefined) out.question = b.question;
  if (b.isPrivate !== undefined) out.isPrivate = b.isPrivate;
  if (b.managerId !== undefined)
    out.managerId = b.managerId === null ? null : ref('user', b.managerId, 'managerId');
  if (b.receivedFromCompanyId !== undefined)
    out.receivedFromCompanyId = ref('company', b.receivedFromCompanyId, 'receivedFromCompanyId');
  if (b.assigneeIds) out.assigneeIds = refs('user', b.assigneeIds, 'assigneeIds')!;
  if (b.distributionUserIds)
    out.distributionUserIds = refs('user', b.distributionUserIds, 'distributionUserIds')!;
  if (b.distributionCompanyIds)
    out.distributionCompanyIds = refs(
      'company',
      b.distributionCompanyIds,
      'distributionCompanyIds',
    )!;
  if (b.dueDate !== undefined) out.dueDate = b.dueDate;
  if (b.costImpact !== undefined) out.costImpact = b.costImpact;
  if (b.costEstimate !== undefined) out.costEstimate = b.costEstimate;
  if (b.scheduleImpactDays !== undefined) out.scheduleImpactDays = b.scheduleImpactDays;
  if (b.delayDays !== undefined) out.delayDays = b.delayDays;
  if (b.specSection !== undefined) out.specSection = b.specSection;
  if (b.location !== undefined) out.location = b.location;
  if (b.pin !== undefined)
    out.pin =
      b.pin === null
        ? null
        : {
            ...b.pin,
            drawingRevisionId: ref(
              'drawingRevision',
              b.pin.drawingRevisionId,
              'pin.drawingRevisionId',
            ),
          };
  return out;
}

export function rfisRoutes(database: Database, rfis: RfiService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const ok = (status: number, x: Awaited<ReturnType<RfiService['detail']>>) => ({
    status,
    body: toRfiDetail(x),
    headers: { etag: etag(x.rfi.version) },
  });

  return defineRoutes({
    listRfis: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        rfis.list(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          ...(q.ballInCourt ? { ballInCourt: ref('user', q.ballInCourt, 'ballInCourt') } : {}),
          ...(q.overdue ? { overdue: q.overdue === 'true' } : {}),
          ...(q.costImpact ? { costImpact: q.costImpact } : {}),
          ...(q.drawingRevisionId
            ? {
                drawingRevisionId: ref('drawingRevision', q.drawingRevisionId, 'drawingRevisionId'),
              }
            : {}),
          ...(q.q ? { q: q.q } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return { status: 200, body: { data: page.data.map(toRfiDto), nextCursor: page.nextCursor } };
    },
    createRfi: async (input) => {
      const x = await tx(input, (s) =>
        rfis.create(s, project(input.params), {
          ...fields(input.body),
          subject: input.body.subject,
          ...(input.body.aiSuggestionId
            ? { aiSuggestionId: ref('aiSuggestion', input.body.aiSuggestionId, 'aiSuggestionId') }
            : {}),
        }),
      );
      return ok(201, x);
    },
    getRfi: async (input) =>
      ok(200, await read(input, (s) => rfis.detail(s, project(input.params), rfiId(input.params)))),
    getRfiActivity: async (input) => ({
      status: 200,
      body: toRfiActivity(
        await read(input, (s) => rfis.activity(s, project(input.params), rfiId(input.params))),
      ),
    }),
    updateRfi: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const x = await tx(input, (s) =>
        rfis.update(s, project(input.params), rfiId(input.params), expected, fields(input.body)),
      );
      return ok(200, x);
    },
    openRfi: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) => rfis.open(s, project(input.params), rfiId(input.params), expected)),
      );
    },
    addRfiResponse: async (input) => {
      const x = await tx(input, (s) =>
        rfis.respond(s, project(input.params), rfiId(input.params), {
          body: input.body.body,
          fileIds: refs('file', input.body.fileIds, 'fileIds') ?? [],
          ...(input.body.aiSuggestionId
            ? { aiSuggestionId: ref('aiSuggestion', input.body.aiSuggestionId, 'aiSuggestionId') }
            : {}),
        }),
      );
      return ok(201, x);
    },
    closeRfi: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const official = ref('rfiResponse', input.body.officialResponseId, 'officialResponseId');
      return ok(
        200,
        await tx(input, (s) =>
          rfis.close(s, project(input.params), rfiId(input.params), expected, official),
        ),
      );
    },
    reopenRfi: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          rfis.reopen(s, project(input.params), rfiId(input.params), expected, input.body.reason),
        ),
      );
    },
    voidRfi: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          rfis.voidRfi(s, project(input.params), rfiId(input.params), expected, input.body.reason),
        ),
      );
    },
  });
}
