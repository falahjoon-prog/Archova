// Tender packages and quotes against the estimating module's endpoints (backend 04 §3), with the same interface as
// the preview source so the screens and hooks don't change. Money is a decimal string in the API and integer cents
// here. Editing calls read the current version first and send it as `If-Match`, so a stale screen gets 412 rather
// than a silent overwrite. Comparison is levelled in the browser from the confirmed quotes (`lib/levelling.ts`),
// the same arithmetic as `GET …/comparison`; the server re-checks the "not the lowest" rule when it records the award.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { allPages } from '@/shared/lib/data-mode';
import { projectMembers } from '@/shared/lib/people';
import { uploadFile } from '@/shared/lib/uploads';
import type { Quote, QuoteLine, QuoteNote, ScopeLine, TenderPackage } from '../lib/quote-types';
import type { QuotesSource } from './quotes-source';

type ApiPackage = components['schemas']['TenderPackage'];
type ApiQuote = components['schemas']['Quote'];
type ApiScopeLine = components['schemas']['ScopeLine'];
type ApiLineInput = components['schemas']['QuoteLineInput'];
type ApiNoteInput = components['schemas']['QuoteNoteInput'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/tender-packages' as const;
const PKG = `${P}/{packageId}` as const;
const QUOTES = `${PKG}/quotes` as const;
const QUOTE = `${QUOTES}/{quoteId}` as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

/** "1234.50" to 123450 without going through a float. */
export function toCents(amount: string): number {
  const [whole = '0', frac = ''] = amount.trim().split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

/** 123450 to "1234.50". */
export function fromCents(cents: number): string {
  const c = Math.round(cents);
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

const num = (s: string | null) => (s === null || s === '' ? null : Number(s));
const decimal = (n: number | null) => (n === null ? null : String(Math.round(n * 1000) / 1000));

const toScope = (s: ApiScopeLine): ScopeLine => ({
  key: s.key,
  description: s.description,
  quantity: num(s.quantity),
  unit: s.unit,
  source: s.source,
});

const fromScope = (s: ScopeLine): ApiScopeLine => ({
  key: s.key,
  description: s.description,
  quantity: decimal(s.quantity),
  unit: s.unit,
  source: s.source,
});

export function createQuotesApi(orgId: string): QuotesSource {
  const names = async (projectId: string) =>
    new Map((await projectMembers(orgId, projectId)).map((p) => [p.id, p.name]));

  const toPackage = (p: ApiPackage, people: ReadonlyMap<string, string>): TenderPackage => ({
    id: p.id,
    number: p.number,
    name: p.name,
    trade: p.trade,
    status: p.status,
    dueAt: p.dueAt,
    scope: p.scope.map(toScope),
    documents: p.documents.map((d) => ({
      id: d.id,
      label: d.kind === 'drawing_revision' ? 'Drawing' : 'Document',
    })),
    invites: p.invites.map((i) => ({
      companyId: i.companyId,
      status: i.status,
      invitedAt: i.invitedAt,
    })),
    allowances: Object.fromEntries(Object.entries(p.allowances).map(([k, v]) => [k, toCents(v)])),
    award: p.award
      ? {
          quoteId: p.award.quoteId,
          by: (p.award.by && people.get(p.award.by)) || 'Project member',
          at: p.award.at,
          reason: p.award.reason,
          notLowest: p.award.notLowest,
        }
      : null,
  });

  const toNotes = (notes: ApiQuote['exclusions']): QuoteNote[] =>
    notes.map((n) => ({ id: n.id, text: n.text, scopeKey: n.scopeKey, source: n.source }));

  const toLines = (lines: ApiQuote['lines']): QuoteLine[] =>
    lines.map((l) => ({
      id: l.id,
      scopeKey: l.scopeKey,
      description: l.description,
      quantity: num(l.quantity),
      unit: l.unit,
      amountCents: toCents(l.amount),
      isProvisional: l.isProvisional,
      source: l.source,
      originalAmountCents: l.originalAmount === null ? null : toCents(l.originalAmount),
    }));

  /** The uploaded file's name, so the review reads "Read from tiling-quote.pdf". */
  const fileName = async (fileId: string | undefined, fallback: string) => {
    if (!fileId) return fallback;
    try {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/files/{fileId}', { params: { path: { orgId, fileId } } }),
      ).filename;
    } catch {
      return fallback;
    }
  };

  const toQuote = async (q: ApiQuote, people: ReadonlyMap<string, string>): Promise<Quote> => ({
    id: q.id,
    packageId: q.packageId,
    companyId: q.companyId,
    version: q.revision,
    status: q.status,
    fileName: await fileName(q.fileIds[0], q.reference ?? 'Quote'),
    reference: q.reference ?? '',
    receivedAt: q.receivedAt,
    validUntil: q.validUntil,
    lines: toLines(q.lines),
    exclusions: toNotes(q.exclusions),
    qualifications: toNotes(q.qualifications),
    source: q.source,
    confirmedBy:
      (q.confirmedBy && people.get(q.confirmedBy)) || (q.confirmedBy ? 'Project member' : null),
  });

  const fetchPackage = async (projectId: string, packageId: string) =>
    unwrap(await api.GET(PKG, { params: { path: { orgId, projectId, packageId } } }));

  const fetchQuote = async (projectId: string, packageId: string, quoteId: string) =>
    unwrap(await api.GET(QUOTE, { params: { path: { orgId, projectId, packageId, quoteId } } }));

  const lineInput = (l: ApiQuote['lines'][number]): ApiLineInput => ({
    id: l.id,
    scopeKey: l.scopeKey,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    rate: l.rate,
    amount: l.amount,
    isProvisional: l.isProvisional,
    source: l.source,
  });

  const noteInput = (n: ApiQuote['exclusions'][number]): ApiNoteInput => ({
    id: n.id,
    text: n.text,
    scopeKey: n.scopeKey,
    source: n.source,
  });

  const withPeople = async <T>(projectId: string, fn: (people: ReadonlyMap<string, string>) => T) =>
    fn(await names(projectId));

  return {
    live: true,

    async listPackages(projectId) {
      const [rows, people] = await Promise.all([
        allPages(async (cursor) =>
          unwrap(
            await api.GET(P, {
              params: { path: { orgId, projectId }, query: { limit: 200, cursor } },
            }),
          ),
        ),
        names(projectId),
      ]);
      return rows.map((p) => toPackage(p, people));
    },

    async getPackage(projectId, packageId) {
      return withPeople(projectId, (people) => people).then(async (people) =>
        toPackage(await fetchPackage(projectId, packageId), people),
      );
    },

    async createPackage(projectId, input) {
      await ensureCsrfToken();
      const created = unwrap(
        await api.POST(P, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body: { name: input.name.trim(), trade: input.trade.trim(), dueAt: input.dueAt },
        }),
      );
      return toPackage(created, await names(projectId));
    },

    async addScopeLines(projectId, packageId, lines) {
      await ensureCsrfToken();
      const current = await fetchPackage(projectId, packageId);
      const updated = unwrap(
        await api.PATCH(PKG, {
          params: { path: { orgId, projectId, packageId }, header: ifMatch(current.version) },
          body: { scope: [...current.scope, ...lines.map(fromScope)] },
        }),
      );
      return toPackage(updated, await names(projectId));
    },

    async invite(projectId, packageId, companyIds) {
      await ensureCsrfToken();
      const updated = unwrap(
        await api.POST(`${PKG}/invites`, {
          params: { path: { orgId, projectId, packageId }, header: idempotencyKey() },
          body: { companyIds },
        }),
      );
      return toPackage(updated, await names(projectId));
    },

    async transition(projectId, packageId, action) {
      await ensureCsrfToken();
      const current = await fetchPackage(projectId, packageId);
      const updated = unwrap(
        await api.POST(`${PKG}/transition`, {
          params: { path: { orgId, projectId, packageId }, header: ifMatch(current.version) },
          body: { action },
        }),
      );
      return toPackage(updated, await names(projectId));
    },

    async listQuotes(projectId, packageId) {
      const [page, people] = await Promise.all([
        api.GET(QUOTES, { params: { path: { orgId, projectId, packageId } } }).then(unwrap),
        names(projectId),
      ]);
      return Promise.all(page.data.map((q) => toQuote(q, people)));
    },

    /** Upload the PDF, let Nova read it against the package's scope, then save what it read for the estimator to check. */
    async uploadQuote(projectId, packageId, input) {
      await ensureCsrfToken();
      const stored = await uploadFile(orgId, { file: input.file, projectId, module: 'estimating' });
      const reading = unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/ai/quote-readings', {
          params: { path: { orgId, projectId } },
          body: { packageId, fileId: stored.id },
        }),
      );
      // Things the estimator has to check before confirming ride along as qualifications on the quote.
      const checks: ApiNoteInput[] = [];
      if (reading.prices !== 'exclude_gst')
        checks.push({
          text:
            reading.prices === 'include_gst'
              ? 'Nova read amounts that include GST. Take the GST out before confirming.'
              : 'It is unclear whether these amounts include GST. Check the quote.',
        });
      if (reading.totalCheck === 'differs')
        checks.push({
          text: `The lines do not add up to the printed total (difference ${reading.difference ?? 'unknown'}). A line may be missed or misread.`,
        });
      const offPage = reading.lines.filter((l) => l.warning === 'amount_not_on_page').length;
      if (offPage)
        checks.push({
          text: `${offPage} ${offPage === 1 ? 'amount is' : 'amounts are'} not printed on the page Nova pointed to. Check against the PDF.`,
        });
      if (reading.skippedPages.length || reading.truncated)
        checks.push({
          text: 'Nova did not read every page of this quote. Check the PDF for the rest.',
        });
      const created = unwrap(
        await api.POST(QUOTES, {
          params: { path: { orgId, projectId, packageId }, header: idempotencyKey() },
          body: {
            companyId: input.companyId,
            ...(reading.reference ? { reference: reading.reference } : {}),
            fileIds: [stored.id],
            ...(reading.validUntil ? { validUntil: reading.validUntil } : {}),
            lines: reading.lines.map((l) => ({
              description: l.description,
              scopeKey: l.scopeKey,
              quantity: l.quantity,
              unit: l.unit,
              rate: l.rate,
              amount: l.amount,
              isProvisional: l.isProvisional,
              source: l.source,
            })),
            exclusions: reading.exclusions.map((n) => ({
              text: n.text,
              scopeKey: n.scopeKey,
              source: n.source,
            })),
            qualifications: [
              ...reading.qualifications.map((n) => ({
                text: n.text,
                scopeKey: n.scopeKey,
                source: n.source,
              })),
              ...checks,
            ],
            aiSuggestionId: reading.suggestionId,
          },
        }),
      );
      return { ...(await toQuote(created, await names(projectId))), fileName: input.file.name };
    },

    async correctLine(projectId, packageId, quoteId, lineId, amountCents) {
      await ensureCsrfToken();
      const current = await fetchQuote(projectId, packageId, quoteId);
      const updated = unwrap(
        await api.PATCH(QUOTE, {
          params: {
            path: { orgId, projectId, packageId, quoteId },
            header: ifMatch(current.version),
          },
          body: {
            lines: current.lines.map((l) =>
              l.id === lineId ? { ...lineInput(l), amount: fromCents(amountCents) } : lineInput(l),
            ),
            exclusions: current.exclusions.map(noteInput),
            qualifications: current.qualifications.map(noteInput),
          },
        }),
      );
      return toQuote(updated, await names(projectId));
    },

    async confirmQuote(projectId, packageId, quoteId) {
      await ensureCsrfToken();
      const current = await fetchQuote(projectId, packageId, quoteId);
      const confirmed = unwrap(
        await api.POST(`${QUOTE}/confirm`, {
          params: {
            path: { orgId, projectId, packageId, quoteId },
            header: ifMatch(current.version),
          },
        }),
      );
      return toQuote(confirmed, await names(projectId));
    },

    async declineQuote(projectId, packageId, quoteId) {
      await ensureCsrfToken();
      const current = await fetchQuote(projectId, packageId, quoteId);
      const declined = unwrap(
        await api.POST(`${QUOTE}/decline`, {
          params: {
            path: { orgId, projectId, packageId, quoteId },
            header: ifMatch(current.version),
          },
        }),
      );
      return toQuote(declined, await names(projectId));
    },

    async setAllowance(projectId, packageId, quoteId, scopeKey, cents) {
      await ensureCsrfToken();
      const current = await fetchPackage(projectId, packageId);
      const allowances = { ...current.allowances };
      const key = `${quoteId}:${scopeKey}`;
      if (cents === null) delete allowances[key];
      else allowances[key] = fromCents(cents);
      const updated = unwrap(
        await api.PUT(`${PKG}/allowances`, {
          params: { path: { orgId, projectId, packageId }, header: ifMatch(current.version) },
          body: { allowances },
        }),
      );
      return toPackage(updated, await names(projectId));
    },

    async award(projectId, packageId, quoteId, reason) {
      await ensureCsrfToken();
      const current = await fetchPackage(projectId, packageId);
      const awarded = unwrap(
        await api.POST(`${PKG}/award`, {
          params: { path: { orgId, projectId, packageId }, header: ifMatch(current.version) },
          body: { quoteId, ...(reason.trim() ? { reason: reason.trim() } : {}) },
        }),
      );
      return toPackage(awarded, await names(projectId));
    },
  };
}
