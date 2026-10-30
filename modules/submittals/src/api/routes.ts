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
import type { SubmittalFields, SubmittalService } from '../application/submittals';
import { toSubmittalDetail, toSubmittalDto } from './mappers';

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
const submittalId = (p: { submittalId: string }) => {
  const id = decodeId('submittal', p.submittalId);
  if (!id) throw new AppError('submittal.not_found');
  return id;
};

type FieldsBody = Omit<SubmittalFields, 'responsibleCompanyId' | 'managerId'> & {
  responsibleCompanyId?: string | null;
  managerId?: string | null;
};

/** Request body → service fields, decoding prefixed ids and keeping "absent" distinct from "null". */
function fields(b: FieldsBody): SubmittalFields {
  const out: SubmittalFields = {};
  if (b.title !== undefined) out.title = b.title;
  if (b.numberLabel !== undefined) out.numberLabel = b.numberLabel;
  if (b.type !== undefined) out.type = b.type;
  if (b.specSection !== undefined) out.specSection = b.specSection;
  if (b.responsibleCompanyId !== undefined)
    out.responsibleCompanyId =
      b.responsibleCompanyId === null
        ? null
        : ref('company', b.responsibleCompanyId, 'responsibleCompanyId');
  if (b.managerId !== undefined)
    out.managerId = b.managerId === null ? null : ref('user', b.managerId, 'managerId');
  if (b.requiredOnSite !== undefined) out.requiredOnSite = b.requiredOnSite;
  if (b.leadTimeDays !== undefined) out.leadTimeDays = b.leadTimeDays;
  if (b.reviewDays !== undefined) out.reviewDays = b.reviewDays;
  return out;
}

export function submittalsRoutes(database: Database, svc: SubmittalService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const ok = (status: number, x: Awaited<ReturnType<SubmittalService['detail']>>) => ({
    status,
    body: toSubmittalDetail(x),
    headers: { etag: etag(x.submittal.version) },
  });

  return defineRoutes({
    listSubmittals: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        svc.list(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          ...(q.type ? { type: q.type } : {}),
          ...(q.ballInCourt ? { ballInCourt: ref('user', q.ballInCourt, 'ballInCourt') } : {}),
          ...(q.q ? { q: q.q } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toSubmittalDto), nextCursor: page.nextCursor },
      };
    },
    createSubmittal: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          svc.create(s, project(input.params), { ...fields(input.body), title: input.body.title }),
        ),
      ),
    getSubmittal: async (input) =>
      ok(
        200,
        await read(input, (s) => svc.detail(s, project(input.params), submittalId(input.params))),
      ),
    updateSubmittal: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          svc.update(
            s,
            project(input.params),
            submittalId(input.params),
            expected,
            fields(input.body),
          ),
        ),
      );
    },
    submitSubmittal: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          svc.submit(s, project(input.params), submittalId(input.params), expected, {
            fileIds: input.body.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`)),
            ...(input.body.note !== undefined ? { note: input.body.note } : {}),
            ...(input.body.reviewerIds
              ? {
                  reviewerIds: input.body.reviewerIds.map((u, i) =>
                    ref('user', u, `reviewerIds/${i}`),
                  ),
                }
              : {}),
          }),
        ),
      );
    },
    respondToSubmittalStep: async (input) =>
      ok(
        200,
        await tx(input, (s) =>
          svc.respond(
            s,
            project(input.params),
            submittalId(input.params),
            ref('submittalStep', input.params.stepId, 'stepId'),
            {
              response: input.body.response,
              ...(input.body.comments !== undefined ? { comments: input.body.comments } : {}),
              fileIds: (input.body.fileIds ?? []).map((f, i) => ref('file', f, `fileIds/${i}`)),
            },
          ),
        ),
      ),
    closeSubmittal: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          svc.close(s, project(input.params), submittalId(input.params), expected),
        ),
      );
    },
  });
}
