// Tender packages and quotes, mirroring `CRUD {p}/tender-packages`, `…/{id}/quotes` and `…/quotes/{q}/lines`,
// `GET …/{id}/comparison` and `POST …/{id}/award` (backend 04 §3). Preview: in-memory store; an uploaded quote is
// "read" by a canned extraction that links every value to a page in the file (EST-AC5).

import type { TakeoffUnit } from '@archova/markup';
import { companyName } from '@/shared/mocks/directory';
import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import { previewElena, type ElenaAnswer, type ElenaTopic } from '../lib/elena';
import { allowanceKey, comparableQuotes, levelQuotes, lowestQuoteId } from '../lib/levelling';
import type { PackageAction, Quote, QuoteLine, ScopeLine, TenderPackage } from '../lib/quote-types';

interface Store {
  packages: TenderPackage[];
  quotes: Quote[];
  nextNumber: number;
  /** Preview only: when a quote being "read" becomes ready. */
  readyAt: Map<string, number>;
}

/** How long the preview pretends Nova takes to read a quote. */
const READ_MS = process.env.NODE_ENV === 'test' ? 0 : 1500;

const TILING_SCOPE: ScopeLine[] = [
  {
    key: 'amen_floor',
    description: 'Floor tiles to amenities, 300×300 porcelain',
    quantity: 48,
    unit: 'm²',
    source: 'typed',
  },
  {
    key: 'amen_wall',
    description: 'Wall tiles to amenities, full height',
    quantity: 96,
    unit: 'm²',
    source: 'typed',
  },
  {
    key: 'lobby_floor',
    description: 'Lobby floor tiles, 600×600 porcelain',
    quantity: 120,
    unit: 'm²',
    source: 'typed',
  },
  {
    key: 'waterproof',
    description: 'Waterproofing to wet areas (AS 3740)',
    quantity: 52,
    unit: 'm²',
    source: 'typed',
  },
  { key: 'skirting', description: 'Tiled skirting', quantity: 80, unit: 'm', source: 'typed' },
];

function line(
  scopeKey: string | null,
  description: string,
  amountCents: number,
  page: number,
  extra: Partial<QuoteLine> = {},
): QuoteLine {
  return {
    id: mockId('qln'),
    scopeKey,
    description,
    quantity: null,
    unit: 'item',
    amountCents,
    isProvisional: false,
    source: {
      page,
      snippet: `${description} … $${(amountCents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`,
    },
    originalAmountCents: null,
    ...extra,
  };
}

function quote(p: Partial<Quote> & Pick<Quote, 'id' | 'companyId' | 'lines'>): Quote {
  return {
    packageId: 'pkg_1',
    version: 1,
    status: 'confirmed',
    fileName: `${p.id}.pdf`,
    reference: `Q-${p.id.slice(-3).toUpperCase()}`,
    receivedAt: '2026-09-26T03:00:00Z',
    validUntil: '2026-11-30',
    exclusions: [],
    qualifications: [],
    source: 'ai_extracted',
    confirmedBy: 'Dana Okafor',
    ...p,
  };
}

function seed(): Store {
  return {
    nextNumber: 3,
    readyAt: new Map(),
    packages: [
      {
        id: 'pkg_1',
        number: 1,
        name: 'Tiling and waterproofing',
        trade: 'Tiling',
        status: 'out_to_tender',
        dueAt: '2026-10-10T05:00:00Z',
        scope: TILING_SCOPE,
        documents: [
          { id: 'sht_a101', label: 'A-101 Rev C' },
          { id: 'doc_spec', label: 'Spec 0421 Waterproofing' },
        ],
        invites: [
          { companyId: 'cmp_tile', status: 'submitted', invitedAt: '2026-09-20T00:00:00Z' },
          { companyId: 'cmp_tile2', status: 'submitted', invitedAt: '2026-09-20T00:00:00Z' },
          { companyId: 'cmp_tile3', status: 'submitted', invitedAt: '2026-09-20T00:00:00Z' },
        ],
        allowances: {},
        award: null,
      },
      {
        id: 'pkg_2',
        number: 2,
        name: 'Painting',
        trade: 'Painting',
        status: 'draft',
        dueAt: '2026-10-24T05:00:00Z',
        scope: [],
        documents: [],
        invites: [],
        allowances: {},
        award: null,
      },
    ],
    quotes: [
      quote({
        id: 'quo_ib1',
        companyId: 'cmp_tile',
        status: 'superseded',
        receivedAt: '2026-09-24T03:00:00Z',
        lines: [
          line('amen_floor', 'Amenities floor tiling', 412000, 1),
          line('amen_wall', 'Amenities wall tiling', 798000, 1),
          line('lobby_floor', 'Lobby floor tiling', 1260000, 2),
          line('waterproof', 'Waterproofing wet areas', 338000, 2),
          line('skirting', 'Skirting tiles', 248000, 2),
        ],
      }),
      quote({
        id: 'quo_ib2',
        companyId: 'cmp_tile',
        version: 2,
        receivedAt: '2026-09-27T03:00:00Z',
        lines: [
          line('amen_floor', 'Amenities floor tiling', 412000, 1),
          line('amen_wall', 'Amenities wall tiling', 798000, 1),
          line('lobby_floor', 'Lobby floor tiling', 1140000, 2),
          line('waterproof', 'Waterproofing wet areas', 338000, 2),
          line('skirting', 'Skirting tiles', 248000, 2),
        ],
        qualifications: [
          {
            id: 'ql1',
            text: 'Tiles supplied by the builder.',
            scopeKey: null,
            source: { page: 3, snippet: 'Tiles supplied by the builder' },
          },
        ],
      }),
      quote({
        id: 'quo_hb1',
        companyId: 'cmp_tile2',
        validUntil: '2026-09-30',
        lines: [
          line('amen_floor', 'Floor tiles amenities', 368000, 1),
          line('amen_wall', 'Wall tiles amenities', 702000, 1),
          line('lobby_floor', 'Lobby floor', 1890000, 1),
          line('skirting', 'Skirting', 0, 2, { isProvisional: true, amountCents: 150000 }),
          line(null, 'Site establishment', 85000, 2),
        ],
        exclusions: [
          {
            id: 'ex1',
            text: 'Waterproofing excluded, by others.',
            scopeKey: 'waterproof',
            source: { page: 3, snippet: 'Waterproofing excluded' },
          },
        ],
      }),
      quote({
        id: 'quo_gg1',
        companyId: 'cmp_tile3',
        status: 'ready_to_review',
        confirmedBy: null,
        receivedAt: '2026-10-01T03:00:00Z',
        lines: [
          line('amen_floor', 'Amenities floors', 395000, 1),
          line('amen_wall', 'Amenities walls', 760000, 1),
          line('lobby_floor', 'Lobby', 1185000, 1),
          line('waterproof', 'Membrane to wet areas', 310000, 2),
        ],
      }),
    ],
  };
}

const stores = projectStores<Store>(seed);

function findPackage(projectId: string, id: string): TenderPackage {
  const p = stores.get(projectId).packages.find((x) => x.id === id);
  if (!p) problem(404, 'not_found', "We couldn't find that tender package.");
  return p;
}

function findQuote(projectId: string, id: string): Quote {
  const q = stores.get(projectId).quotes.find((x) => x.id === id);
  if (!q) problem(404, 'not_found', "We couldn't find that quote.");
  return q;
}

/** Preview extraction: a priced line per scope line (some missed), from page 1–2 of the file. */
function extract(
  pkg: TenderPackage,
  seedText: string,
): Pick<Quote, 'lines' | 'exclusions' | 'qualifications'> {
  const h = [...seedText].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 3);
  const lines = pkg.scope
    .filter((_, i) => (h + i) % 5 !== 0)
    .map((s, i) =>
      line(
        s.key,
        s.description,
        Math.round((s.quantity ?? 10) * (70 + ((h + i * 13) % 60)) * 100),
        1 + (i % 2),
      ),
    );
  return { lines, exclusions: [], qualifications: [] };
}

function settleReading(s: Store) {
  for (const q of s.quotes) {
    const at = s.readyAt.get(q.id);
    if (q.status === 'reading' && at !== undefined && Date.now() >= at) {
      q.status = 'ready_to_review';
      s.readyAt.delete(q.id);
    }
  }
}

export interface QuotesSource {
  /** The API (true) or the in-browser preview store (false): the preview reads an uploaded file by name only. */
  live: boolean;
  listPackages(projectId: string): Promise<TenderPackage[]>;
  getPackage(projectId: string, id: string): Promise<TenderPackage>;
  createPackage(
    projectId: string,
    input: { name: string; trade: string; dueAt: string },
  ): Promise<TenderPackage>;
  addScopeLines(projectId: string, packageId: string, lines: ScopeLine[]): Promise<TenderPackage>;
  invite(projectId: string, packageId: string, companyIds: string[]): Promise<TenderPackage>;
  /** Send a draft out to tender, or close, reopen or cancel it. */
  transition(projectId: string, packageId: string, action: PackageAction): Promise<TenderPackage>;
  listQuotes(projectId: string, packageId: string): Promise<Quote[]>;
  uploadQuote(
    projectId: string,
    packageId: string,
    input: { companyId: string; file: File },
  ): Promise<Quote>;
  correctLine(
    projectId: string,
    packageId: string,
    quoteId: string,
    lineId: string,
    amountCents: number,
  ): Promise<Quote>;
  confirmQuote(
    projectId: string,
    packageId: string,
    quoteId: string,
    actor: { name: string },
  ): Promise<Quote>;
  declineQuote(projectId: string, packageId: string, quoteId: string): Promise<Quote>;
  setAllowance(
    projectId: string,
    packageId: string,
    quoteId: string,
    scopeKey: string,
    cents: number | null,
  ): Promise<TenderPackage>;
  award(
    projectId: string,
    packageId: string,
    quoteId: string,
    reason: string,
    actor: { name: string },
    today: string,
  ): Promise<TenderPackage>;
  /** Elena on one confirmed quote (`POST …/ai/quote-negotiations`); nothing is saved or sent. */
  askElena(
    projectId: string,
    packageId: string,
    input: { quoteId: string; targetCents: number | null; topic: ElenaTopic; today: string },
  ): Promise<ElenaAnswer>;
}

export const quotesSource: QuotesSource & {
  addTakeoffLines(
    projectId: string,
    packageId: string,
    totals: Array<{ tag: string; quantity: number; unit: TakeoffUnit }>,
  ): Promise<TenderPackage>;
} = {
  live: false,

  /** Preview of `POST …/ai/quote-negotiations`: Elena on one confirmed quote; nothing is saved or sent. */
  async askElena(
    projectId: string,
    packageId: string,
    input: { quoteId: string; targetCents: number | null; topic: ElenaTopic; today: string },
  ): Promise<ElenaAnswer> {
    const pkg = findPackage(projectId, packageId);
    const quotes = comparableQuotes(
      stores.get(projectId).quotes.filter((q) => q.packageId === packageId),
    );
    const quote = quotes.find((q) => q.id === input.quoteId);
    if (!quote)
      problem(
        404,
        'quote.not_found',
        'Elena can only help with a confirmed quote of this package.',
      );
    if (input.targetCents !== null && input.targetCents <= 0)
      problem(422, 'validation', 'The target price must be more than zero.');
    const { rows, totals } = levelQuotes(pkg, quotes, input.today);
    return delay(
      previewElena({
        quote,
        rows,
        totals,
        trade: pkg.trade,
        targetCents: input.targetCents,
        topic: input.topic,
      }),
    );
  },

  async listPackages(projectId: string): Promise<TenderPackage[]> {
    return delay(stores.get(projectId).packages);
  },

  async getPackage(projectId: string, id: string): Promise<TenderPackage> {
    return delay(findPackage(projectId, id));
  },

  async createPackage(
    projectId: string,
    input: { name: string; trade: string; dueAt: string },
  ): Promise<TenderPackage> {
    if (!input.name.trim() || !input.trade.trim())
      problem(422, 'validation', 'Give the package a name and trade.');
    const s = stores.get(projectId);
    const pkg: TenderPackage = {
      id: mockId('pkg'),
      number: s.nextNumber++,
      name: input.name.trim(),
      trade: input.trade.trim(),
      status: 'draft',
      dueAt: input.dueAt,
      scope: [],
      documents: [],
      invites: [],
      allowances: {},
      award: null,
    };
    s.packages.push(pkg);
    return delay(pkg);
  },

  async addScopeLines(
    projectId: string,
    packageId: string,
    lines: ScopeLine[],
  ): Promise<TenderPackage> {
    const pkg = findPackage(projectId, packageId);
    if (pkg.status === 'awarded') problem(409, 'package.awarded', 'This package is awarded.');
    pkg.scope.push(...lines);
    return delay(pkg);
  },

  /** EST-US8: quantities from takeoff become scope lines, one per tag and unit. */
  async addTakeoffLines(
    projectId: string,
    packageId: string,
    totals: Array<{ tag: string; quantity: number; unit: TakeoffUnit }>,
  ): Promise<TenderPackage> {
    const unitLabel: Record<TakeoffUnit, string> = { ea: 'ea', m: 'm', m2: 'm²' };
    return this.addScopeLines(
      projectId,
      packageId,
      totals.map((t) => ({
        key: mockId('scp'),
        description: t.tag,
        quantity: Math.round(t.quantity * 100) / 100,
        unit: unitLabel[t.unit],
        source: 'takeoff' as const,
      })),
    );
  },

  async invite(projectId: string, packageId: string, companyIds: string[]): Promise<TenderPackage> {
    const pkg = findPackage(projectId, packageId);
    if (!pkg.scope.length)
      problem(422, 'package.no_scope', 'Add scope lines before inviting subcontractors.');
    for (const companyId of companyIds) {
      if (!pkg.invites.some((i) => i.companyId === companyId))
        pkg.invites.push({ companyId, status: 'invited', invitedAt: nowIso() });
    }
    if (pkg.status === 'draft') pkg.status = 'out_to_tender';
    return delay(pkg);
  },

  async transition(
    projectId: string,
    packageId: string,
    action: PackageAction,
  ): Promise<TenderPackage> {
    const pkg = findPackage(projectId, packageId);
    if (pkg.status === 'awarded') problem(409, 'package.awarded', 'This package is awarded.');
    if (action === 'send') {
      if (pkg.status !== 'draft') problem(409, 'package.not_draft', 'Only a draft can be sent.');
      if (!pkg.scope.length) problem(422, 'package.no_scope', 'Add scope lines first.');
      if (!pkg.invites.length) problem(422, 'package.no_invites', 'Invite a subcontractor first.');
      pkg.status = 'out_to_tender';
    } else if (action === 'close') pkg.status = 'closed';
    else if (action === 'reopen') pkg.status = 'out_to_tender';
    else pkg.status = 'cancelled';
    return delay(pkg);
  },

  async declineQuote(projectId: string, _packageId: string, quoteId: string): Promise<Quote> {
    const q = findQuote(projectId, quoteId);
    if (q.status === 'superseded' || q.status === 'declined')
      problem(409, 'quote.not_open', 'That quote is already out of the comparison.');
    q.status = 'declined';
    return delay(q);
  },

  async listQuotes(projectId: string, packageId: string): Promise<Quote[]> {
    const s = stores.get(projectId);
    settleReading(s);
    return delay(s.quotes.filter((q) => q.packageId === packageId));
  },

  /** A new quote from a company supersedes its earlier one; both are kept (EST-AC4). */
  async uploadQuote(
    projectId: string,
    packageId: string,
    input: { companyId: string; file: File },
  ): Promise<Quote> {
    const s = stores.get(projectId);
    const pkg = findPackage(projectId, packageId);
    const earlier = s.quotes.filter(
      (q) => q.packageId === packageId && q.companyId === input.companyId,
    );
    for (const q of earlier) if (q.status !== 'declined') q.status = 'superseded';
    const q: Quote = {
      id: mockId('quo'),
      packageId,
      companyId: input.companyId,
      version: earlier.length + 1,
      status: 'reading',
      fileName: input.file.name,
      reference: '',
      receivedAt: nowIso(),
      validUntil: null,
      ...extract(pkg, `${input.companyId}${input.file.name}`),
      source: 'ai_extracted',
      confirmedBy: null,
    };
    s.quotes.push(q);
    s.readyAt.set(q.id, Date.now() + READ_MS);
    const invite = pkg.invites.find((i) => i.companyId === input.companyId);
    if (invite) invite.status = 'submitted';
    else pkg.invites.push({ companyId: input.companyId, status: 'submitted', invitedAt: nowIso() });
    return delay(q);
  },

  /** A corrected value keeps Nova's original so it goes back as feedback. */
  async correctLine(
    projectId: string,
    _packageId: string,
    quoteId: string,
    lineId: string,
    amountCents: number,
  ): Promise<Quote> {
    const q = findQuote(projectId, quoteId);
    const l = q.lines.find((x) => x.id === lineId);
    if (!l) problem(404, 'not_found', 'That line is not on this quote.');
    if (!Number.isFinite(amountCents) || amountCents < 0)
      problem(422, 'validation', 'Enter an amount of zero or more.');
    if (l.originalAmountCents === null && amountCents !== l.amountCents)
      l.originalAmountCents = l.amountCents;
    l.amountCents = Math.round(amountCents);
    return delay(q);
  },

  /** Extracted values are suggestions until the estimator confirms the quote (EST-AC5). */
  async confirmQuote(
    projectId: string,
    _packageId: string,
    quoteId: string,
    actor: { name: string },
  ): Promise<Quote> {
    const q = findQuote(projectId, quoteId);
    if (q.status !== 'ready_to_review')
      problem(409, 'quote.not_ready', 'Only a quote that is ready to review can be confirmed.');
    q.status = 'confirmed';
    q.confirmedBy = actor.name;
    return delay(q);
  },

  async setAllowance(
    projectId: string,
    packageId: string,
    quoteId: string,
    scopeKey: string,
    cents: number | null,
  ): Promise<TenderPackage> {
    const pkg = findPackage(projectId, packageId);
    const key = allowanceKey(quoteId, scopeKey);
    if (cents === null) delete pkg.allowances[key];
    else pkg.allowances[key] = Math.round(cents);
    return delay(pkg);
  },

  /** EST-AC7: records who, when and why; a reason is required unless it's the lowest like-for-like total. */
  async award(
    projectId: string,
    packageId: string,
    quoteId: string,
    reason: string,
    actor: { name: string },
    today: string,
  ): Promise<TenderPackage> {
    const s = stores.get(projectId);
    const pkg = findPackage(projectId, packageId);
    if (pkg.status === 'awarded')
      problem(409, 'package.awarded', 'This package is already awarded.');
    const quotes = comparableQuotes(s.quotes.filter((q) => q.packageId === packageId));
    if (!quotes.some((q) => q.id === quoteId))
      problem(422, 'quote.not_comparable', 'Only confirmed, current quotes can be selected.');
    const { totals } = levelQuotes(pkg, quotes, today);
    const lowest = lowestQuoteId(totals, true);
    const notLowest = lowest !== quoteId;
    if (notLowest && !reason.trim())
      problem(
        422,
        'award.reason_required',
        `Say why you chose ${companyName(findQuote(projectId, quoteId).companyId)} over the lowest quote.`,
      );
    pkg.status = 'awarded';
    pkg.award = { quoteId, by: actor.name, at: nowIso(), reason: reason.trim() || null, notLowest };
    return delay(pkg);
  },
};

export function resetQuotesPreview() {
  stores.reset();
}
