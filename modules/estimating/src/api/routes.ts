import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  ACCESS_LINK_COOKIE,
  ACCESS_LINK_SESSION_MS,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
  type Logger,
  type MessageSender,
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
import type { MeasurementFields, TakeoffService } from '../application/takeoff';
import type { EstimateService, LineInput as EstimateLineInput } from '../application/estimate';
import type { IssueResult, TenderLinkService } from '../application/tender-links';
import type { BiddersService } from '../application/bidders';
import type { BoardService } from '../application/board';
import type { LibraryService } from '../application/library';
import {
  toBidderListDto,
  toBoardEntryDto,
  toComparisonDto,
  toCostItemDto,
  toCostRateDto,
  toEstimateDto,
  toEstimateSummaryDto,
  toMeasurementDto,
  toPackageDto,
  toQuoteDto,
} from './mappers';

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
const measurementIdOf = (p: { measurementId: string }) => {
  const id = decodeId('takeoffMeasurement', p.measurementId);
  if (!id) throw new AppError('takeoff.not_found');
  return id;
};
const bidderListIdOf = (p: { bidderListId: string }) => {
  const id = decodeId('bidderList', p.bidderListId);
  if (!id) throw new AppError('bidder_list.not_found');
  return id;
};
const companyIds = (ids: string[] | undefined) =>
  ids?.map((c, i) => ref('company', c, `companyIds/${i}`));
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
  aiSuggestionId?: string;
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
  if (b.aiSuggestionId !== undefined)
    out.aiSuggestionId = ref('aiSuggestion', b.aiSuggestionId, 'aiSuggestionId');
  return out;
}

type MeasurementBody = {
  label?: string;
  geometry?: MeasurementFields['geometry'];
  quantity?: string;
  unit?: string;
  confidence?: number | null;
  packageId?: string | null;
  scopeKey?: string | null;
};

function measurementFields(b: MeasurementBody): MeasurementFields {
  const out: MeasurementFields = {};
  if (b.label !== undefined) out.label = b.label;
  if (b.geometry !== undefined) out.geometry = b.geometry;
  if (b.quantity !== undefined) out.quantity = b.quantity;
  if (b.unit !== undefined) out.unit = b.unit;
  if (b.confidence !== undefined) out.confidence = b.confidence;
  if (b.packageId !== undefined)
    out.packageId = b.packageId === null ? null : ref('tenderPackage', b.packageId, 'packageId');
  if (b.scopeKey !== undefined) out.scopeKey = b.scopeKey;
  return out;
}

const costItemIdOf = (p: { costItemId: string }) => {
  const id = decodeId('costItem', p.costItemId);
  if (!id) throw new AppError('cost_item.not_found');
  return id;
};
const estimateIdOf = (p: { estimateId: string }) => {
  const id = decodeId('estimate', p.estimateId);
  if (!id) throw new AppError('estimate.not_found');
  return id;
};
const lineIdOf = (p: { lineId: string }) => {
  const id = decodeId('estimateLine', p.lineId);
  if (!id) throw new AppError('estimate.line_not_found');
  return id;
};

type LineBody = Omit<EstimateLineInput, 'parentId' | 'costItemId' | 'measurementIds'> & {
  parentId?: string | null;
  costItemId?: string | null;
  measurementIds?: string[];
};

function lineFields(b: LineBody): EstimateLineInput {
  const { parentId, costItemId, measurementIds, ...rest } = b;
  return {
    ...rest,
    ...(parentId !== undefined
      ? { parentId: parentId === null ? null : ref('estimateLine', parentId, 'parentId') }
      : {}),
    ...(costItemId !== undefined
      ? { costItemId: costItemId === null ? null : ref('costItem', costItemId, 'costItemId') }
      : {}),
    ...(measurementIds !== undefined
      ? {
          measurementIds: measurementIds.map((m, i) =>
            ref('takeoffMeasurement', m, `measurementIds/${i}`),
          ),
        }
      : {}),
  };
}

export interface TenderMail {
  messages: MessageSender;
  /** The public web origin the invite links point at, e.g. `https://app.archova.com.au`. */
  baseUrl: string;
  /** "Name (email)" of the signed-in member, for the "Sent by" line (Sam 11 §7). */
  senderName(userId: string): Promise<string>;
  logger?: Pick<Logger, 'warn'>;
}

const LINK_HEADERS = {
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'cache-control': 'no-store',
};

export function estimatingRoutes(
  database: Database,
  svc: TenderService,
  takeoff: TakeoffService,
  library: LibraryService,
  estimates: EstimateService,
  board: BoardService,
  bidders: BiddersService,
  tenderLinks: TenderLinkService,
  mail: TenderMail,
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const facts = (input: { ip: string; userAgent: string | null; requestId: string }) => ({
    ip: input.ip,
    userAgent: input.userAgent,
    requestId: input.requestId,
  });
  const linkCookie = (input: { cookies: Readonly<Record<string, string | undefined>> }) =>
    input.cookies[ACCESS_LINK_COOKIE];

  /**
   * Emails each invite link after the transaction commits, then records when it went out. A failed email leaves
   * the invite at "not delivered" so the sender can resend; it never undoes the invite.
   */
  async function deliver(
    input: { tenant: TenantContext | null },
    projectId: string,
    packageId: string,
    result: IssueResult,
  ) {
    if (result.noEmail.length)
      mail.logger?.warn(
        { packageId, companies: result.noEmail.length },
        'tender invite has no email',
      );
    if (!result.issued.length) return;
    const tenant = requireTenant(input);
    const info = await tx(input, async (s) => {
      const names = await tenderLinks.names(s, projectId);
      return { p: await svc.get(s, projectId, packageId), ...names };
    });
    const sentBy = await mail.senderName(tenant.userId);
    const delivered: string[] = [];
    for (const l of result.issued) {
      const due = info.p.dueAt
        ? `Quotes are due ${info.p.dueAt.toISOString().slice(0, 10)}.`
        : null;
      const lines = [
        `${info.org} invited ${l.companyName} to quote on ${info.project}.`,
        `Sent by ${sentBy}.`,
        `${info.p.name} (${info.p.trade})`,
        ...(due ? [due] : []),
        '',
        `See the scope and tell them if you will quote: ${mail.baseUrl}/q/${l.token}`,
        `This link is for ${l.email} and works until ${l.expiresAt.toISOString().slice(0, 10)}. You don't need an account.`,
      ];
      try {
        await mail.messages.email(l.email, {
          subject: `${info.org}: invitation to quote ${info.p.name}`,
          text: lines.join('\n'),
        });
        delivered.push(l.inviteId);
      } catch (e) {
        mail.logger?.warn({ err: e, inviteId: l.inviteId }, 'tender invite email failed');
      }
    }
    if (delivered.length) await tx(input, (s) => tenderLinks.markDelivered(s, delivered));
  }

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

  const measurement = (status: number, x: Awaited<ReturnType<TakeoffService['get']>>) => ({
    status,
    body: toMeasurementDto(x),
    headers: { etag: etag(x.version) },
  });

  const costItem = (status: number, x: Awaited<ReturnType<LibraryService['get']>>) => ({
    status,
    body: toCostItemDto(x),
    headers: { etag: etag(x.version) },
  });
  const sheet = (status: number, x: Awaited<ReturnType<EstimateService['get']>>) => ({
    status,
    body: toEstimateDto(x),
    headers: { etag: etag(x.estimate.version) },
  });

  return defineRoutes({
    listCostItems: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        library.list(s, {
          ...(q.q ? { q: q.q } : {}),
          ...(q.trade ? { trade: q.trade } : {}),
          ...(q.category ? { category: q.category } : {}),
          ...(q.region ? { region: q.region } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toCostItemDto), nextCursor: page.nextCursor },
      };
    },
    createCostItem: async (input) =>
      costItem(
        201,
        await tx(input, (s) =>
          library.create(s, {
            code: input.body.code,
            description: input.body.description,
            unit: input.body.unit,
            ...(input.body.trade !== undefined ? { trade: input.body.trade } : {}),
            ...(input.body.category !== undefined ? { category: input.body.category } : {}),
            ...(input.body.rate ? { rate: input.body.rate } : {}),
          }),
        ),
      ),
    getCostItem: async (input) =>
      costItem(200, await read(input, (s) => library.get(s, costItemIdOf(input.params)))),
    updateCostItem: async (input) =>
      costItem(
        200,
        await tx(input, (s) =>
          library.update(
            s,
            costItemIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
            input.body,
          ),
        ),
      ),
    deleteCostItem: async (input) => {
      await tx(input, (s) => library.remove(s, costItemIdOf(input.params)));
      return { status: 204 };
    },
    listCostRates: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => library.listRates(s, costItemIdOf(input.params)))).map(
          toCostRateDto,
        ),
      },
    }),
    addCostRate: async (input) => ({
      status: 201,
      body: {
        data: (
          await tx(input, (s) => library.addRate(s, costItemIdOf(input.params), input.body))
        ).map(toCostRateDto),
      },
    }),
    listEstimates: async (input) => {
      const page = await read(input, (s) =>
        estimates.list(s, project(input.params), {
          limit: input.query.limit,
          ...(input.query.cursor ? { cursor: input.query.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toEstimateSummaryDto), nextCursor: page.nextCursor },
      };
    },
    createEstimate: async (input) =>
      sheet(201, await tx(input, (s) => estimates.create(s, project(input.params), input.body))),
    getEstimate: async (input) =>
      sheet(
        200,
        await read(input, (s) =>
          estimates.get(s, project(input.params), estimateIdOf(input.params)),
        ),
      ),
    updateEstimate: async (input) =>
      sheet(
        200,
        await tx(input, (s) =>
          estimates.update(
            s,
            project(input.params),
            estimateIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
            input.body,
          ),
        ),
      ),
    deleteEstimate: async (input) => {
      await tx(input, (s) =>
        estimates.remove(s, project(input.params), estimateIdOf(input.params)),
      );
      return { status: 204 };
    },
    addEstimateLine: async (input) =>
      sheet(
        201,
        await tx(input, (s) =>
          estimates.addLine(
            s,
            project(input.params),
            estimateIdOf(input.params),
            lineFields(input.body),
          ),
        ),
      ),
    updateEstimateLine: async (input) =>
      sheet(
        200,
        await tx(input, (s) =>
          estimates.updateLine(
            s,
            project(input.params),
            estimateIdOf(input.params),
            lineIdOf(input.params),
            lineFields(input.body),
          ),
        ),
      ),
    deleteEstimateLine: async (input) =>
      sheet(
        200,
        await tx(input, (s) =>
          estimates.removeLine(
            s,
            project(input.params),
            estimateIdOf(input.params),
            lineIdOf(input.params),
          ),
        ),
      ),
    issueEstimate: async (input) =>
      sheet(
        200,
        await tx(input, (s) =>
          estimates.issue(
            s,
            project(input.params),
            estimateIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
          ),
        ),
      ),
    listTakeoffMeasurements: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        takeoff.list(s, project(input.params), {
          ...(q.revisionId
            ? { revisionId: ref('drawingRevision', q.revisionId, 'revisionId') }
            : {}),
          ...(q.packageId ? { packageId: ref('tenderPackage', q.packageId, 'packageId') } : {}),
          ...(q.confirmed ? { confirmed: q.confirmed === 'true' } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toMeasurementDto), nextCursor: page.nextCursor },
      };
    },
    createTakeoffMeasurement: async (input) =>
      measurement(
        201,
        await tx(input, (s) =>
          takeoff.create(s, project(input.params), {
            ...measurementFields(input.body),
            revisionId: ref('drawingRevision', input.body.revisionId, 'revisionId'),
            kind: input.body.kind,
            source: input.body.source ?? 'manual',
            label: input.body.label,
            geometry: input.body.geometry,
            quantity: input.body.quantity,
            unit: input.body.unit,
          }),
        ),
      ),
    getTakeoffMeasurement: async (input) =>
      measurement(
        200,
        await read(input, (s) =>
          takeoff.get(s, project(input.params), measurementIdOf(input.params)),
        ),
      ),
    updateTakeoffMeasurement: async (input) =>
      measurement(
        200,
        await tx(input, (s) =>
          takeoff.update(
            s,
            project(input.params),
            measurementIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
            measurementFields(input.body),
          ),
        ),
      ),
    deleteTakeoffMeasurement: async (input) => {
      await tx(input, (s) =>
        takeoff.remove(s, project(input.params), measurementIdOf(input.params)),
      );
      return { status: 204 };
    },
    confirmTakeoffMeasurement: async (input) =>
      measurement(
        200,
        await tx(input, (s) =>
          takeoff.confirm(
            s,
            project(input.params),
            measurementIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
          ),
        ),
      ),
    createAssistedTakeoffMeasurements: async (input) => {
      const rows = await tx(input, (s) =>
        takeoff.createAssisted(
          s,
          project(input.params),
          ref('drawingRevision', input.body.revisionId, 'revisionId'),
          input.body.items.map((i) => ({
            kind: i.kind,
            label: i.label,
            geometry: i.geometry,
            quantity: i.quantity,
            unit: i.unit,
            confidence: i.confidence,
          })),
        ),
      );
      return { status: 201, body: { data: rows.map(toMeasurementDto) } };
    },
    confirmTakeoffMeasurements: async (input) => {
      const rows = await tx(input, (s) =>
        takeoff.confirmMany(s, project(input.params), {
          revisionId: ref('drawingRevision', input.body.revisionId, 'revisionId'),
          ...(input.body.ids
            ? { ids: input.body.ids.map((id) => ref('takeoffMeasurement', id, 'ids')) }
            : {}),
          ...(input.body.minConfidence !== undefined
            ? { minConfidence: input.body.minConfidence }
            : {}),
        }),
      );
      return { status: 200, body: { data: rows.map(toMeasurementDto) } };
    },
    rejectTakeoffMeasurement: async (input) =>
      measurement(
        200,
        await tx(input, (s) =>
          takeoff.reject(
            s,
            project(input.params),
            measurementIdOf(input.params),
            parseIfMatch(input.headers['if-match']),
          ),
        ),
      ),
    listBidderLists: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) =>
            bidders.list(s, input.query.trade ? { trade: input.query.trade } : {}),
          )
        ).map(toBidderListDto),
      },
    }),
    createBidderList: async (input) => {
      const row = await tx(input, (s) =>
        bidders.create(s, {
          name: input.body.name,
          ...(input.body.trade !== undefined ? { trade: input.body.trade } : {}),
          ...(input.body.companyIds ? { companyIds: companyIds(input.body.companyIds)! } : {}),
        }),
      );
      return { status: 201, body: toBidderListDto(row), headers: { etag: etag(row.version) } };
    },
    updateBidderList: async (input) => {
      const b = input.body;
      const row = await tx(input, (s) =>
        bidders.update(s, bidderListIdOf(input.params), parseIfMatch(input.headers['if-match']), {
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.trade !== undefined ? { trade: b.trade } : {}),
          ...(b.companyIds ? { companyIds: companyIds(b.companyIds)! } : {}),
        }),
      );
      return { status: 200, body: toBidderListDto(row), headers: { etag: etag(row.version) } };
    },
    deleteBidderList: async (input) => {
      await tx(input, (s) => bidders.remove(s, bidderListIdOf(input.params)));
      return { status: 204 };
    },
    getBidBoard: async (input) => {
      const q = input.query;
      const r = await read(input, (s) =>
        board.board(s, {
          ...(q.status ? { status: q.status } : {}),
          ...(q.trade ? { trade: q.trade } : {}),
          ...(q.projectId ? { projectId: ref('project', q.projectId, 'projectId') } : {}),
        }),
      );
      return {
        status: 200,
        body: {
          data: r.data.map(toBoardEntryDto),
          asOf: r.asOf.toISOString(),
          truncated: r.truncated,
        },
      };
    },
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
    transitionTenderPackage: async (input) => {
      const p = project(input.params);
      const id = pkgId(input.params);
      // Sending (or reopening) puts the package out to tender, so every invited company gets its link.
      const r = await tx(input, async (s) => ({
        x: await svc.transition(
          s,
          p,
          id,
          parseIfMatch(input.headers['if-match']),
          input.body.action,
        ),
        links: await tenderLinks.issue(s, p, id),
      }));
      await deliver(input, p, id, r.links);
      return pkg(200, await read(input, (s) => svc.get(s, p, id)));
    },
    inviteToTenderPackage: async (input) => {
      const p = project(input.params);
      const id = pkgId(input.params);
      const r = await tx(input, async (s) => ({
        x: await svc.invite(
          s,
          p,
          id,
          input.body.companyIds.map((c, i) => ref('company', c, `companyIds/${i}`)),
          input.body.overrideReason,
        ),
        links: await tenderLinks.issue(s, p, id),
      }));
      await deliver(input, p, id, r.links);
      return pkg(200, await read(input, (s) => svc.get(s, p, id)));
    },
    resendTenderInvite: async (input) => {
      const p = project(input.params);
      const id = pkgId(input.params);
      const companyId = ref('company', input.params.companyId, 'companyId');
      const links = await tx(input, async (s) => {
        await svc.get(s, p, id);
        return tenderLinks.resend(s, p, id, companyId);
      });
      await deliver(input, p, id, links);
      return pkg(200, await read(input, (s) => svc.get(s, p, id)));
    },
    openTenderAccess: async (input) => {
      const r = await tenderLinks.open(input.body.token, facts(input));
      return {
        status: 200,
        body: r.body,
        headers: LINK_HEADERS,
        setCookies: [
          {
            name: ACCESS_LINK_COOKIE,
            value: r.cookie,
            httpOnly: true,
            maxAgeSeconds: Math.floor(ACCESS_LINK_SESSION_MS / 1000),
          },
        ],
      };
    },
    getTenderAccess: async (input) => ({
      status: 200,
      body: await tenderLinks.view(linkCookie(input), facts(input)),
      headers: LINK_HEADERS,
    }),
    respondTenderAccess: async (input) => ({
      status: 200,
      body: await tenderLinks.respond(linkCookie(input), input.body.response, facts(input)),
      headers: LINK_HEADERS,
    }),
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
    createSubcontractFromAward: async (input) => {
      const r = await tx(input, (s) =>
        svc.createSubcontract(s, project(input.params), pkgId(input.params)),
      );
      return {
        status: 200,
        body: {
          contractId: encodeId('contract', r.contract.id),
          number: r.contract.number,
          title: r.contract.title,
          originalValue: r.contract.originalValue,
          created: r.created,
        },
      };
    },
    createCommitmentFromAward: async (input) => {
      const r = await tx(input, (s) =>
        svc.createCommitment(
          s,
          project(input.params),
          pkgId(input.params),
          ref('budgetLine', input.body.budgetLineId, 'budgetLineId'),
        ),
      );
      return {
        status: 200,
        body: {
          commitmentId: encodeId('commitment', r.commitment.id),
          number: r.commitment.number,
          title: r.commitment.title,
          total: r.commitment.total,
          created: r.created,
        },
      };
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
    getQuoteComparison: async (input) => {
      const packageId = pkgId(input.params);
      const comparison = await read(input, (s) =>
        svc.comparison(s, project(input.params), packageId),
      );
      return { status: 200, body: toComparisonDto(packageId, comparison) };
    },
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
