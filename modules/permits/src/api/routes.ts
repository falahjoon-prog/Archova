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
import type { PermitFields, PermitService } from '../application/permits';
import type { PermitKind } from '../domain/permit';
import { toFlagDto, toPermitDetail, toPermitDto, toRequirementDto } from './mappers';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};

type Body = {
  kind?: PermitKind;
  title?: string;
  issuingAuthority?: string | null;
  referenceNumber?: string | null;
  holderCompanyId?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
  fileIds?: string[];
};

function fields(b: Body): PermitFields {
  const out: PermitFields = {};
  if (b.kind !== undefined) out.kind = b.kind;
  if (b.title !== undefined) out.title = b.title;
  if (b.issuingAuthority !== undefined) out.issuingAuthority = b.issuingAuthority;
  if (b.referenceNumber !== undefined) out.referenceNumber = b.referenceNumber;
  if (b.holderCompanyId !== undefined)
    out.holderCompanyId =
      b.holderCompanyId === null ? null : ref('company', b.holderCompanyId, 'holderCompanyId');
  if (b.issuedOn !== undefined) out.issuedOn = b.issuedOn;
  if (b.expiresOn !== undefined) out.expiresOn = b.expiresOn;
  if (b.notes !== undefined) out.notes = b.notes;
  if (b.fileIds !== undefined) out.fileIds = b.fileIds.map((f) => ref('file', f, 'fileIds'));
  return out;
}

export function permitsRoutes(database: Database, permits: PermitService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const project = (p: { projectId: string }) => {
    const id = decodeId('project', p.projectId);
    if (!id) throw new AppError('project.not_found');
    return id;
  };
  const permitId = (p: { permitId: string }) => {
    const id = decodeId('permit', p.permitId);
    if (!id) throw new AppError('permit.not_found');
    return id;
  };
  const ok = (status: number, d: Awaited<ReturnType<PermitService['detail']>>) => ({
    status,
    body: toPermitDetail(d),
    headers: { etag: etag(d.permit.version) },
  });

  return defineRoutes({
    listPermits: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        permits.list(s, project(input.params), {
          ...(q.kind ? { kind: q.kind } : {}),
          ...(q.status ? { status: q.status } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toPermitDto), nextCursor: page.nextCursor },
      };
    },
    createPermit: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          permits.create(s, project(input.params), {
            ...fields(input.body),
            kind: input.body.kind,
            title: input.body.title,
          }),
        ),
      ),
    getPermit: async (input) =>
      ok(
        200,
        await read(input, (s) => permits.detail(s, project(input.params), permitId(input.params))),
      ),
    updatePermit: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          permits.update(
            s,
            project(input.params),
            permitId(input.params),
            expected,
            fields(input.body),
          ),
        ),
      );
    },
    transitionPermit: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      return ok(
        200,
        await tx(input, (s) =>
          permits.transition(s, project(input.params), permitId(input.params), expected, {
            action: b.action,
            ...(b.newExpiresOn !== undefined ? { newExpiresOn: b.newExpiresOn } : {}),
            ...(b.note !== undefined ? { note: b.note } : {}),
          }),
        ),
      );
    },
    listPermitFlags: async (input) => {
      const flags = await read(input, (s) =>
        permits.flags(s, project(input.params), input.query.windowDays),
      );
      return { status: 200, body: { data: flags.map(toFlagDto) } };
    },
    getPermitRequirements: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => permits.getRequirements(s, project(input.params)))).map(
          toRequirementDto,
        ),
      },
    }),
    setPermitRequirements: async (input) => ({
      status: 200,
      body: {
        data: (
          await tx(input, (s) =>
            permits.setRequirements(s, project(input.params), input.body.items),
          )
        ).map(toRequirementDto),
      },
    }),
  });
}
