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
import type {
  LineInput,
  NoteInput,
  PackageFields,
  QuoteInput,
  TenderService,
} from '../application/tender';
import { toPackageDto, toQuoteDto } from './mappers';

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
const pkgId = (p: { packageId: string }) => {
  const id = decodeId('tenderPackage', p.packageId);
  if (!id) throw new AppError('tender.not_found');
  return id;
};
const quoteIdOf = (p: { quoteId: string }) => {
  const id = decodeId('quote', p.quoteId);
  if (!id) throw new AppError('quote.not_found');
  return id;
};

type PackageBody = {
  name?: string;
  trade?: string;
  dueAt?: string | null;
  scope?: PackageFields['scope'];
  documents?: Array<{ kind: 'drawing_revision' | 'document'; id: string }>;
};

function packageFields(b: PackageBody): PackageFields {
  const out: PackageFields = {};
  if (b.name !== undefined) out.name = b.name;
  if (b.trade !== undefined) out.trade = b.trade;
  if (b.dueAt !== undefined) out.dueAt = b.dueAt === null ? null : new Date(b.dueAt);
  if (b.scope !== undefined) out.scope = b.scope;
  if (b.documents !== undefined)
    out.documents = b.documents.map((d, i) => ({
      kind: d.kind,
      id: ref(
        d.kind === 'drawing_revision' ? 'drawingRevision' : 'document',
        d.id,
        `documents/${i}/id`,
      ),
    }));
  return out;
}

const lineIn = (l: { id?: string } & Omit<LineInput, 'id'>, i: number): LineInput => ({
  ...l,
  ...(l.id ? { id: ref('quoteLine', l.id, `lines/${i}/id`) } : {}),
});

type QuoteBody = {
  companyId?: string;
  reference?: string | null;
  fileIds?: string[];
  validUntil?: string | null;
  lines?: Array<{ id?: string } & Omit<LineInput, 'id'>>;
  exclusions?: NoteInput[];
  qualifications?: NoteInput[];
};

function quoteFields(b: QuoteBody): QuoteInput {
  const out: QuoteInput = {};
  if (b.companyId !== undefined) out.companyId = ref('company', b.companyId, 'companyId');
  if (b.reference !== undefined) out.reference = b.reference;
  if (b.fileIds !== undefined)
    out.fileIds = b.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`));
  if (b.validUntil !== undefined) out.validUntil = b.validUntil;
  if (b.lines !== undefined) out.lines = b.lines.map(lineIn);
  if (b.exclusions !== undefined) out.exclusions = b.exclusions;
  if (b.qualifications !== undefined) out.qualifications = b.qualifications;
  return out;
}

export function estimatingRoutes(database: Database, svc: TenderService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const pkg = (status: number, x: Awaited<ReturnType<TenderService['get']>>) => ({
    status,
    body: toPackageDto(x),
    headers: { etag: etag(x.version) },
  });
  const quote = (status: number, x: Awaited<ReturnType<TenderService['getQuote']>>) => ({
    status,
    body: toQuoteDto(x),
    headers: { etag: etag(x.version) },
  });

  return defineRoutes({
    listTenderPackages: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        svc.list(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toPackageDto), nextCursor: page.nextCursor },
      };
    },
    createTenderPackage: async (input) =>
      pkg(
        201,
        await tx(input, (s) =>
          svc.create(s, project(input.params), {
            ...packageFields(input.body),
            name: input.body.name,
            trade: input.body.trade,
          }),
        ),
      ),
    getTenderPackage: async (input) =>
      pkg(200, await read(input, (s) => svc.get(s, project(input.params), pkgId(input.params)))),
    updateTenderPackage: async (input) =>
      pkg(
        200,
        await tx(input, (s) =>
          svc.update(
            s,
            project(input.params),
            pkgId(input.params),
            parseIfMatch(input.headers['if-match']),
            packageFields(input.body),
          ),
        ),
      ),
    transitionTenderPackage: async (input) =>
      pkg(
        200,
        await tx(input, (s) =>
          svc.transition(
            s,
            project(input.params),
            pkgId(input.params),
            parseIfMatch(input.headers['if-match']),
            input.body.action,
          ),
        ),
      ),
    inviteToTenderPackage: async (input) =>
      pkg(
        200,
        await tx(input, (s) =>
          svc.invite(
            s,
            project(input.params),
            pkgId(input.params),
            input.body.companyIds.map((c, i) => ref('company', c, `companyIds/${i}`)),
          ),
        ),
      ),
    setTenderPackageAllowances: async (input) => {
      const allowances: Record<string, string> = {};
      for (const [k, v] of Object.entries(input.body.allowances)) {
        const [quote, ...rest] = k.split(':');
        allowances[`${ref('quote', quote ?? '', `allowances/${k}`)}:${rest.join(':')}`] = v;
      }
      return pkg(
        200,
        await tx(input, (s) =>
          svc.setAllowances(
            s,
            project(input.params),
            pkgId(input.params),
            parseIfMatch(input.headers['if-match']),
            allowances,
          ),
        ),
      );
    },
    awardTenderPackage: async (input) =>
      pkg(
        200,
        await tx(input, (s) =>
          svc.award(
            s,
            project(input.params),
            pkgId(input.params),
            parseIfMatch(input.headers['if-match']),
            {
              quoteId: ref('quote', input.body.quoteId, 'quoteId'),
              ...(input.body.reason ? { reason: input.body.reason } : {}),
            },
          ),
        ),
      ),
    listQuotes: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) => svc.listQuotes(s, project(input.params), pkgId(input.params)))
        ).map(toQuoteDto),
      },
    }),
    createQuote: async (input) =>
      quote(
        201,
        await tx(input, (s) =>
          svc.createQuote(s, project(input.params), pkgId(input.params), {
            ...quoteFields(input.body),
            lines: input.body.lines.map(lineIn),
          }),
        ),
      ),
    getQuote: async (input) =>
      quote(
        200,
        await read(input, (s) =>
          svc.getQuote(s, project(input.params), pkgId(input.params), quoteIdOf(input.params)),
        ),
      ),
    updateQuote: async (input) =>
      quote(
        200,
        await tx(input, (s) =>
          svc.updateQuote(
            s,
            project(input.params),
            pkgId(input.params),
            quoteIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
            quoteFields(input.body),
          ),
        ),
      ),
    confirmQuote: async (input) =>
      quote(
        200,
        await tx(input, (s) =>
          svc.confirmQuote(
            s,
            project(input.params),
            pkgId(input.params),
            quoteIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
          ),
        ),
      ),
    declineQuote: async (input) =>
      quote(
        200,
        await tx(input, (s) =>
          svc.declineQuote(
            s,
            project(input.params),
            pkgId(input.params),
            quoteIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
          ),
        ),
      ),
  });
}
