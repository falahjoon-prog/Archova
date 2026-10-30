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
import { toSwmsDetail, toSwmsDto } from './mappers';

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

export function safetyRoutes(database: Database, swms: SwmsService) {
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

  return defineRoutes({
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
