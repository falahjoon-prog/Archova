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
import type { CoverFields, CoverService } from '../application/covers';
import type { CoverKind } from '../domain/cover';
import { toClearanceDto, toFlagDto, toCoverDetail, toCoverDto, toRequirementDto } from './mappers';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};

type Body = {
  kind?: CoverKind;
  title?: string;
  issuer?: string | null;
  amountCents?: number | null;
  referenceNumber?: string | null;
  companyId?: string;
  issuedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
  fileIds?: string[];
};

function fields(b: Body): CoverFields {
  const out: CoverFields = {};
  if (b.kind !== undefined) out.kind = b.kind;
  if (b.title !== undefined) out.title = b.title;
  if (b.issuer !== undefined) out.issuer = b.issuer;
  if (b.amountCents !== undefined) out.amountCents = b.amountCents;
  if (b.referenceNumber !== undefined) out.referenceNumber = b.referenceNumber;
  if (b.companyId !== undefined) out.companyId = ref('company', b.companyId, 'companyId');
  if (b.issuedOn !== undefined) out.issuedOn = b.issuedOn;
  if (b.expiresOn !== undefined) out.expiresOn = b.expiresOn;
  if (b.notes !== undefined) out.notes = b.notes;
  if (b.fileIds !== undefined) out.fileIds = b.fileIds.map((f) => ref('file', f, 'fileIds'));
  return out;
}

export function insuranceRoutes(database: Database, covers: CoverService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const project = (p: { projectId: string }) => {
    const id = decodeId('project', p.projectId);
    if (!id) throw new AppError('project.not_found');
    return id;
  };
  const coverId = (p: { coverId: string }) => {
    const id = decodeId('cover', p.coverId);
    if (!id) throw new AppError('cover.not_found');
    return id;
  };
  const ok = (status: number, d: Awaited<ReturnType<CoverService['detail']>>) => ({
    status,
    body: toCoverDetail(d),
    headers: { etag: etag(d.cover.version) },
  });

  return defineRoutes({
    listCovers: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        covers.list(s, project(input.params), {
          ...(q.kind ? { kind: q.kind } : {}),
          ...(q.companyId ? { companyId: ref('company', q.companyId, 'companyId') } : {}),
          ...(q.status ? { status: q.status } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toCoverDto), nextCursor: page.nextCursor },
      };
    },
    createCover: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          covers.create(s, project(input.params), {
            ...fields(input.body),
            kind: input.body.kind,
            title: input.body.title,
            companyId: ref('company', input.body.companyId, 'companyId'),
          }),
        ),
      ),
    getCover: async (input) =>
      ok(
        200,
        await read(input, (s) => covers.detail(s, project(input.params), coverId(input.params))),
      ),
    updateCover: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          covers.update(
            s,
            project(input.params),
            coverId(input.params),
            expected,
            fields(input.body),
          ),
        ),
      );
    },
    transitionCover: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      return ok(
        200,
        await tx(input, (s) =>
          covers.transition(s, project(input.params), coverId(input.params), expected, {
            action: b.action,
            ...(b.newExpiresOn !== undefined ? { newExpiresOn: b.newExpiresOn } : {}),
            ...(b.note !== undefined ? { note: b.note } : {}),
          }),
        ),
      );
    },
    listCoverFlags: async (input) => {
      const flags = await read(input, (s) =>
        covers.flags(s, project(input.params), input.query.windowDays),
      );
      return { status: 200, body: { data: flags.map(toFlagDto) } };
    },
    getCompanyClearance: async (input) => {
      const companyId = ref('company', input.params.companyId, 'companyId');
      const c = await read(input, (s) =>
        covers.companyClearance(s, project(input.params), companyId),
      );
      return { status: 200, body: toClearanceDto(companyId, c) };
    },
    getCoverRequirements: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => covers.getRequirements(s, project(input.params)))).map(
          toRequirementDto,
        ),
      },
    }),
    setCoverRequirements: async (input) => ({
      status: 200,
      body: {
        data: (
          await tx(input, (s) => covers.setRequirements(s, project(input.params), input.body.items))
        ).map(toRequirementDto),
      },
    }),
  });
}
