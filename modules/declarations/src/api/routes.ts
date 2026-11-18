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
import type { StatementFields, StatementService } from '../application/statements';
import type { DeclarationKind } from '../domain/declaration';
import {
  toChaseDto,
  toChaseResultDto,
  toClaimStatusDto,
  toDeclarationDetail,
  toDeclarationDto,
  toFlagDto,
  toRequirementDto,
} from './mappers';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};

type Body = {
  kind?: DeclarationKind;
  companyId?: string;
  declarantName?: string | null;
  declarantPosition?: string | null;
  declaredOn?: string | null;
  validFrom?: string;
  validTo?: string;
  issuer?: string | null;
  referenceNumber?: string | null;
  claimId?: string | null;
  notes?: string | null;
  fileIds?: string[];
  readByNova?: boolean;
};

function fields(b: Body): StatementFields {
  const out: StatementFields = {};
  if (b.kind !== undefined) out.kind = b.kind;
  if (b.companyId !== undefined) out.companyId = ref('company', b.companyId, 'companyId');
  if (b.declarantName !== undefined) out.declarantName = b.declarantName;
  if (b.declarantPosition !== undefined) out.declarantPosition = b.declarantPosition;
  if (b.declaredOn !== undefined) out.declaredOn = b.declaredOn;
  if (b.validFrom !== undefined) out.validFrom = b.validFrom;
  if (b.validTo !== undefined) out.validTo = b.validTo;
  if (b.issuer !== undefined) out.issuer = b.issuer;
  if (b.referenceNumber !== undefined) out.referenceNumber = b.referenceNumber;
  if (b.claimId !== undefined)
    out.claimId = b.claimId === null ? null : ref('paymentClaim', b.claimId, 'claimId');
  if (b.notes !== undefined) out.notes = b.notes;
  if (b.fileIds !== undefined) out.fileIds = b.fileIds.map((f) => ref('file', f, 'fileIds'));
  if (b.readByNova !== undefined) out.readByNova = b.readByNova;
  return out;
}

export function declarationsRoutes(database: Database, svc: StatementService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const project = (p: { projectId: string }) => {
    const id = decodeId('project', p.projectId);
    if (!id) throw new AppError('project.not_found');
    return id;
  };
  const declarationId = (p: { declarationId: string }) => {
    const id = decodeId('declaration', p.declarationId);
    if (!id) throw new AppError('declaration.not_found');
    return id;
  };
  const ok = (status: number, d: Awaited<ReturnType<StatementService['detail']>>) => ({
    status,
    body: toDeclarationDetail(d),
    headers: { etag: etag(d.declaration.version) },
  });

  return defineRoutes({
    listDeclarations: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        svc.list(s, project(input.params), {
          ...(q.kind ? { kind: q.kind } : {}),
          ...(q.companyId ? { companyId: ref('company', q.companyId, 'companyId') } : {}),
          ...(q.status ? { status: q.status } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toDeclarationDto), nextCursor: page.nextCursor },
      };
    },
    createDeclaration: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          svc.create(s, project(input.params), {
            ...fields(input.body),
            kind: input.body.kind,
            companyId: ref('company', input.body.companyId, 'companyId'),
            validFrom: input.body.validFrom,
            validTo: input.body.validTo,
          }),
        ),
      ),
    getDeclaration: async (input) =>
      ok(
        200,
        await read(input, (s) => svc.detail(s, project(input.params), declarationId(input.params))),
      ),
    updateDeclaration: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          svc.update(
            s,
            project(input.params),
            declarationId(input.params),
            expected,
            fields(input.body),
          ),
        ),
      );
    },
    transitionDeclaration: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      return ok(
        200,
        await tx(input, (s) =>
          svc.transition(s, project(input.params), declarationId(input.params), expected, {
            action: b.action,
            ...(b.note !== undefined ? { note: b.note } : {}),
          }),
        ),
      );
    },
    listDeclarationFlags: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => svc.flags(s, project(input.params)))).map(toFlagDto),
      },
    }),
    getDeclarationRequirements: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => svc.getRequirements(s, project(input.params)))).map(
          toRequirementDto,
        ),
      },
    }),
    setDeclarationRequirements: async (input) => ({
      status: 200,
      body: {
        data: (
          await tx(input, (s) => svc.setRequirements(s, project(input.params), input.body.items))
        ).map(toRequirementDto),
      },
    }),
    listDeclarationClaims: async (input) => {
      const r = await read(input, (s) => svc.claimStatuses(s, project(input.params)));
      return {
        status: 200,
        body: { requirementsSet: r.requirementsSet, data: r.data.map(toClaimStatusDto) },
      };
    },
    chaseDeclarations: async (input) => {
      const b = input.body;
      const r = await tx(input, (s) =>
        svc.chase(s, project(input.params), {
          companyId: ref('company', b.companyId, 'companyId'),
          ...(b.claimId ? { claimId: ref('paymentClaim', b.claimId, 'claimId') } : {}),
          send: b.send === true,
          subject: b.subject ?? null,
          body: b.body ?? null,
        }),
      );
      return { status: 200, body: toChaseResultDto(r) };
    },
    listDeclarationChases: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) =>
            svc.listChases(
              s,
              project(input.params),
              input.query.companyId
                ? ref('company', input.query.companyId, 'companyId')
                : undefined,
            ),
          )
        ).map(toChaseDto),
      },
    }),
  });
}
