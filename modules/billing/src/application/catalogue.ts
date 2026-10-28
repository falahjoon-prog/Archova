import { and, asc, desc, eq, inArray, lte, max } from 'drizzle-orm';
import type {
  PlanDraftInput,
  PlanDto,
  PlanVersionDto,
  PriceBookDto,
  PriceBookPreview,
  PriceChange,
  PriceInput,
} from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Tx, type KernelServices } from '@archova/kernel';
import { planVersions, plans, priceBooks, prices } from '../infra/tables';

/** A price increase needs this much notice before it takes effect (backend 09 §4). */
export const INCREASE_NOTICE_DAYS = 60;
const DAY_MS = 86_400_000;

export interface PublicPriceBook {
  version: string;
  effectiveFrom: string | null;
  currency: 'AUD';
  gstIncluded: false;
  plans: Array<{
    code: string;
    name: string;
    blurb: string;
    features: string[];
    cta: { label: string; href: string };
    price: { unit: 'free' | 'user_month' | 'year'; fromPrice: boolean; amountCents: number | null };
  }>;
}

type VersionRow = typeof planVersions.$inferSelect;
type BookRow = typeof priceBooks.$inferSelect;

const versionDto = (v: VersionRow): PlanVersionDto => ({
  id: v.id,
  version: v.version,
  status: v.status,
  name: v.name,
  blurb: v.blurb,
  features: v.features,
  modules: v.modules,
  aiCreditsMonthly: v.aiCreditsMonthly,
  ctaLabel: v.ctaLabel,
  ctaHref: v.ctaHref,
  publishedAt: v.publishedAt?.toISOString() ?? null,
});

const priceDto = (p: typeof prices.$inferSelect): PriceInput => ({
  planCode: p.planCode,
  unit: p.unit,
  fromPrice: p.fromPrice,
  amountCents: p.amountCents,
});

const bookDto = (b: BookRow, rows: Array<typeof prices.$inferSelect>): PriceBookDto => ({
  id: b.id,
  version: b.version,
  status: b.status as PriceBookDto['status'],
  effectiveFrom: b.effectiveFrom?.toISOString() ?? null,
  createdBy: b.createdBy,
  publishedAt: b.publishedAt?.toISOString() ?? null,
  prices: rows.map(priceDto).sort((a, b) => a.planCode.localeCompare(b.planCode)),
});

const priceKey = (p: { planCode: string }) => p.planCode;

/**
 * Plans, plan versions and price books (backend 09 §4). Commands here never decide who may call them: the
 * `backoffice` module checks staff permissions and approvals, then calls them. Publishing is a command the
 * approval executes, so a draft can never go live by editing alone.
 */
export function createCatalogueService({ database }: Pick<KernelServices, 'database'>) {
  const global = <T>(fn: (tx: Tx) => Promise<T>) => database.withGlobalTx('billing', fn);

  /** Scheduled price books go live on their date (a daily job in production; lazily on read until then). */
  async function activateDue(tx: Tx, now = new Date()) {
    const [due] = await tx
      .select()
      .from(priceBooks)
      .where(and(eq(priceBooks.status, 'scheduled'), lte(priceBooks.effectiveFrom, now)));
    if (due) await makeLive(tx, due.id, due.createdBy, now);
  }

  async function makeLive(tx: Tx, id: string, by: string | null, now: Date) {
    await tx
      .update(priceBooks)
      .set({ status: 'retired' })
      .where(eq(priceBooks.status, 'published'));
    await tx
      .update(priceBooks)
      .set({ status: 'published', publishedAt: now, publishedBy: by })
      .where(eq(priceBooks.id, id));
  }

  // ---- public price book -------------------------------------------------------------------------------

  async function getPublicPriceBook(now = new Date()): Promise<PublicPriceBook | null> {
    return global(async (tx) => {
      await activateDue(tx, now);
      const [book] = await tx.select().from(priceBooks).where(eq(priceBooks.status, 'published'));
      if (!book) return null;
      const rows = await tx.select().from(prices).where(eq(prices.priceBookId, book.id));
      const codes = rows.map((r) => r.planCode);
      if (!codes.length) return null;
      const versions = await tx
        .select()
        .from(planVersions)
        .where(and(eq(planVersions.status, 'published'), inArray(planVersions.planCode, codes)));
      const order = await tx.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.code));
      const byCode = new Map(versions.map((v) => [v.planCode, v]));
      const out: PublicPriceBook['plans'] = [];
      for (const plan of order) {
        const v = byCode.get(plan.code);
        const p = rows.find((r) => r.planCode === plan.code);
        if (!v || !p) continue;
        out.push({
          code: plan.code,
          name: v.name,
          blurb: v.blurb,
          features: v.features,
          cta: { label: v.ctaLabel, href: v.ctaHref },
          price: { unit: p.unit, fromPrice: p.fromPrice, amountCents: p.amountCents },
        });
      }
      return {
        version: book.version,
        effectiveFrom: book.effectiveFrom?.toISOString() ?? null,
        currency: 'AUD',
        gstIncluded: false,
        plans: out,
      };
    });
  }

  // ---- plans -------------------------------------------------------------------------------------------

  async function listPlans(): Promise<PlanDto[]> {
    return global(async (tx) => {
      const ps = await tx.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.code));
      const vs = await tx
        .select()
        .from(planVersions)
        .where(inArray(planVersions.status, ['draft', 'pending_approval', 'published']));
      return ps.map((p) => ({
        code: p.code,
        sortOrder: p.sortOrder,
        published: pick(vs, p.code, ['published']),
        draft: pick(vs, p.code, ['draft', 'pending_approval']),
      }));
    });
  }

  const pick = (vs: VersionRow[], code: string, statuses: string[]) => {
    const v = vs.find((x) => x.planCode === code && statuses.includes(x.status));
    return v ? versionDto(v) : null;
  };

  const fields = (d: PlanDraftInput) => ({
    name: d.name,
    blurb: d.blurb,
    features: d.features,
    modules: d.modules,
    aiCreditsMonthly: d.aiCreditsMonthly,
    ctaLabel: d.ctaLabel,
    ctaHref: d.ctaHref,
  });

  async function createPlan(code: string, draft: PlanDraftInput, staffId: string) {
    return global(async (tx) => {
      const [existing] = await tx.select().from(plans).where(eq(plans.code, code));
      if (existing) throw new AppError('backoffice.plan_exists', `Plan ${code} already exists.`);
      const [row] = await tx.select({ top: max(plans.sortOrder) }).from(plans);
      await tx.insert(plans).values({ code, sortOrder: (row?.top ?? 0) + 10, createdBy: staffId });
      await tx.insert(planVersions).values({
        id: uuidv7(),
        planCode: code,
        version: 1,
        status: 'draft',
        createdBy: staffId,
        ...fields(draft),
      });
    });
  }

  /** Edits the open draft, or starts one from the live version. A draft already awaiting approval is locked. */
  async function savePlanDraft(code: string, draft: PlanDraftInput, staffId: string) {
    return global(async (tx) => {
      await requirePlan(tx, code);
      const [open] = await tx
        .select()
        .from(planVersions)
        .where(
          and(
            eq(planVersions.planCode, code),
            inArray(planVersions.status, ['draft', 'pending_approval']),
          ),
        );
      if (open?.status === 'pending_approval')
        throw new AppError(
          'backoffice.plan_draft_pending',
          'This draft is waiting for approval. Cancel the request to edit it.',
        );
      if (open) {
        await tx.update(planVersions).set(fields(draft)).where(eq(planVersions.id, open.id));
        return;
      }
      const [row] = await tx
        .select({ top: max(planVersions.version) })
        .from(planVersions)
        .where(eq(planVersions.planCode, code));
      await tx.insert(planVersions).values({
        id: uuidv7(),
        planCode: code,
        version: (row?.top ?? 0) + 1,
        status: 'draft',
        createdBy: staffId,
        ...fields(draft),
      });
    });
  }

  async function requirePlan(tx: Tx, code: string) {
    const [p] = await tx.select().from(plans).where(eq(plans.code, code));
    if (!p) throw new AppError('backoffice.plan_not_found');
  }

  async function openDraft(tx: Tx, code: string) {
    await requirePlan(tx, code);
    const [d] = await tx
      .select()
      .from(planVersions)
      .where(
        and(
          eq(planVersions.planCode, code),
          inArray(planVersions.status, ['draft', 'pending_approval']),
        ),
      );
    if (!d) throw new AppError('backoffice.plan_no_draft', 'There is no draft to change.');
    return d;
  }

  async function discardPlanDraft(code: string) {
    return global(async (tx) => {
      const d = await openDraft(tx, code);
      if (d.status === 'pending_approval')
        throw new AppError('backoffice.plan_draft_pending', 'Cancel the approval request first.');
      await tx.delete(planVersions).where(eq(planVersions.id, d.id));
      // A plan that never went live goes with its only draft.
      const left = await tx
        .select({ id: planVersions.id })
        .from(planVersions)
        .where(eq(planVersions.planCode, code));
      if (!left.length) await tx.delete(plans).where(eq(plans.code, code));
    });
  }

  /** Marks the draft as awaiting approval and returns it for the request preview. */
  async function submitPlanDraft(code: string) {
    return global(async (tx) => {
      const d = await openDraft(tx, code);
      if (d.status !== 'draft')
        throw new AppError('backoffice.plan_draft_pending', 'Already waiting for approval.');
      await tx
        .update(planVersions)
        .set({ status: 'pending_approval' })
        .where(eq(planVersions.id, d.id));
      return { id: d.id, name: d.name, version: d.version };
    });
  }

  async function returnPlanDraft(code: string) {
    return global(async (tx) => {
      await tx
        .update(planVersions)
        .set({ status: 'draft' })
        .where(and(eq(planVersions.planCode, code), eq(planVersions.status, 'pending_approval')));
    });
  }

  async function publishPlanDraft(code: string, staffId: string, now = new Date()) {
    return global(async (tx) => {
      const d = await openDraft(tx, code);
      if (d.status !== 'pending_approval')
        throw new AppError('backoffice.plan_no_draft', 'The draft was not submitted for approval.');
      await tx
        .update(planVersions)
        .set({ status: 'retired' })
        .where(and(eq(planVersions.planCode, code), eq(planVersions.status, 'published')));
      await tx
        .update(planVersions)
        .set({ status: 'published', publishedAt: now, publishedBy: staffId })
        .where(eq(planVersions.id, d.id));
      return { version: d.version };
    });
  }

  // ---- price books -------------------------------------------------------------------------------------

  async function listPriceBooks(): Promise<PriceBookDto[]> {
    return global(async (tx) => {
      await activateDue(tx);
      const books = await tx.select().from(priceBooks).orderBy(desc(priceBooks.seq));
      const rows = await tx.select().from(prices);
      return books.map((b) =>
        bookDto(
          b,
          rows.filter((r) => r.priceBookId === b.id),
        ),
      );
    });
  }

  async function loadBook(tx: Tx, id: string) {
    const [b] = await tx.select().from(priceBooks).where(eq(priceBooks.id, id));
    if (!b) throw new AppError('backoffice.price_book_not_found');
    const rows = await tx.select().from(prices).where(eq(prices.priceBookId, id));
    return { book: b, rows };
  }

  async function getPriceBook(id: string): Promise<PriceBookDto> {
    return global(async (tx) => {
      const { book, rows } = await loadBook(tx, id);
      return bookDto(book, rows);
    });
  }

  /** Starts a draft from the live price book. Only one open draft exists at a time. */
  async function createPriceBook(staffId: string): Promise<PriceBookDto> {
    return global(async (tx) => {
      await activateDue(tx);
      const [open] = await tx
        .select()
        .from(priceBooks)
        .where(inArray(priceBooks.status, ['draft', 'pending_approval', 'scheduled']));
      if (open)
        throw new AppError(
          'conflict',
          `Price book ${open.version} is already ${open.status.replace('_', ' ')}. Finish or discard it first.`,
        );
      const [live] = await tx.select().from(priceBooks).where(eq(priceBooks.status, 'published'));
      const [row] = await tx.select({ top: max(priceBooks.seq) }).from(priceBooks);
      const seq = (row?.top ?? 0) + 1;
      const id = uuidv7();
      await tx.insert(priceBooks).values({
        id,
        seq,
        version: `pb-${seq}`,
        status: 'draft',
        previousId: live?.id ?? null,
        createdBy: staffId,
      });
      if (live) {
        const rows = await tx.select().from(prices).where(eq(prices.priceBookId, live.id));
        if (rows.length)
          await tx.insert(prices).values(rows.map((r) => ({ ...r, priceBookId: id })));
      }
      const { book, rows } = await loadBook(tx, id);
      return bookDto(book, rows);
    });
  }

  async function savePriceBook(
    id: string,
    input: { effectiveFrom: string | null; prices: PriceInput[] },
  ) {
    return global(async (tx) => {
      const { book } = await loadBook(tx, id);
      if (book.status !== 'draft')
        throw new AppError('backoffice.price_book_not_draft', 'Only a draft can be edited.');
      const codes = new Set<string>();
      for (const p of input.prices) {
        if (codes.has(p.planCode))
          throw new AppError('backoffice.price_book_invalid', `${p.planCode} is listed twice.`);
        codes.add(p.planCode);
      }
      const known = await tx
        .select({ code: plans.code })
        .from(plans)
        .where(inArray(plans.code, [...codes]));
      const missing = [...codes].filter((c) => !known.some((k) => k.code === c));
      if (missing.length)
        throw new AppError('backoffice.price_book_invalid', `Unknown plan: ${missing.join(', ')}.`);
      await tx
        .update(priceBooks)
        .set({ effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null })
        .where(eq(priceBooks.id, id));
      await tx.delete(prices).where(eq(prices.priceBookId, id));
      await tx.insert(prices).values(
        input.prices.map((p) => ({
          priceBookId: id,
          planCode: p.planCode,
          unit: p.unit,
          fromPrice: p.fromPrice,
          amountCents: p.amountCents,
        })),
      );
    });
  }

  async function discardPriceBook(id: string) {
    return global(async (tx) => {
      const { book } = await loadBook(tx, id);
      if (book.status !== 'draft')
        throw new AppError('backoffice.price_book_not_draft', 'Only a draft can be discarded.');
      await tx.delete(priceBooks).where(eq(priceBooks.id, id));
    });
  }

  /** Before and after against the live book, plus the rules publishing enforces (backend 09 §4 step 2 and 4). */
  async function previewPriceBook(id: string, now = new Date()): Promise<PriceBookPreview> {
    return global(async (tx) => {
      await activateDue(tx, now);
      const { book, rows } = await loadBook(tx, id);
      const [live] = await tx.select().from(priceBooks).where(eq(priceBooks.status, 'published'));
      const before = live
        ? await tx.select().from(prices).where(eq(prices.priceBookId, live.id))
        : [];
      return diffBooks(before, rows, book.effectiveFrom, now);
    });
  }

  /** Marks the draft as awaiting approval; refuses a draft that breaks a publishing rule. */
  async function submitPriceBook(id: string, now = new Date()) {
    return global(async (tx) => {
      const preview = await previewPriceBook(id, now);
      const { book } = await loadBook(tx, id);
      if (book.status !== 'draft')
        throw new AppError('backoffice.price_book_not_draft', 'Only a draft can be submitted.');
      if (preview.problems.length)
        throw new AppError(
          preview.problems.some((p) => p.startsWith('A price increase'))
            ? 'backoffice.notice_too_short'
            : 'backoffice.price_book_invalid',
          preview.problems[0],
        );
      await tx.update(priceBooks).set({ status: 'pending_approval' }).where(eq(priceBooks.id, id));
      return { version: book.version, preview };
    });
  }

  async function returnPriceBook(id: string) {
    return global(async (tx) => {
      await tx
        .update(priceBooks)
        .set({ status: 'draft' })
        .where(and(eq(priceBooks.id, id), eq(priceBooks.status, 'pending_approval')));
    });
  }

  /** The approval's command: goes live now, or is scheduled for its effective date. Re-checks the notice rule. */
  async function publishPriceBook(id: string, staffId: string, now = new Date()) {
    return global(async (tx) => {
      const preview = await previewPriceBook(id, now);
      const { book } = await loadBook(tx, id);
      if (book.status !== 'pending_approval')
        throw new AppError('backoffice.price_book_not_draft', 'The price book was not submitted.');
      if (preview.problems.length)
        throw new AppError('backoffice.notice_too_short', preview.problems[0]);
      if (book.effectiveFrom && book.effectiveFrom > now) {
        await tx
          .update(priceBooks)
          .set({ status: 'scheduled', publishedBy: staffId })
          .where(eq(priceBooks.id, id));
        return { version: book.version, outcome: 'scheduled' as const };
      }
      await tx
        .update(priceBooks)
        .set({ effectiveFrom: book.effectiveFrom ?? now })
        .where(eq(priceBooks.id, id));
      await makeLive(tx, id, staffId, now);
      return { version: book.version, outcome: 'published' as const };
    });
  }

  return {
    getPublicPriceBook,
    listPlans,
    createPlan,
    savePlanDraft,
    discardPlanDraft,
    submitPlanDraft,
    returnPlanDraft,
    publishPlanDraft,
    listPriceBooks,
    getPriceBook,
    createPriceBook,
    savePriceBook,
    discardPriceBook,
    previewPriceBook,
    submitPriceBook,
    returnPriceBook,
    publishPriceBook,
  };
}

export type CatalogueService = ReturnType<typeof createCatalogueService>;

type PriceRow = { planCode: string; unit: string; fromPrice: boolean; amountCents: number | null };

/** Pure: what changes between the live and the draft price book, and which publishing rules it breaks. */
export function diffBooks(
  before: PriceRow[],
  after: PriceRow[],
  effectiveFrom: Date | null,
  now: Date,
): PriceBookPreview {
  const b = new Map(before.map((r) => [priceKey(r), r]));
  const a = new Map(after.map((r) => [priceKey(r), r]));
  const changes: PriceChange[] = [];
  for (const code of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(code);
    const y = a.get(code);
    const unit = (y ?? x)!.unit as PriceChange['unit'];
    let kind: PriceChange['kind'];
    if (!x) kind = 'added';
    else if (!y) kind = 'removed';
    else if (x.unit !== y.unit)
      kind = 'increase'; // a changed billing unit can raise the bill: needs notice too
    else if ((x.amountCents ?? 0) > (y.amountCents ?? 0)) kind = 'decrease';
    else if ((x.amountCents ?? 0) < (y.amountCents ?? 0) || (!x.fromPrice && y.fromPrice))
      kind = 'increase';
    else kind = 'unchanged';
    changes.push({
      planCode: code,
      unit,
      before: x ? { amountCents: x.amountCents, fromPrice: x.fromPrice } : null,
      after: y ? { amountCents: y.amountCents, fromPrice: y.fromPrice } : null,
      kind,
    });
  }
  changes.sort((p, q) => p.planCode.localeCompare(q.planCode));
  const hasIncrease = changes.some((c) => c.kind === 'increase');
  const earliest = hasIncrease ? new Date(now.getTime() + INCREASE_NOTICE_DAYS * DAY_MS) : null;
  const problems: string[] = [];
  if (!changes.some((c) => c.kind !== 'unchanged') && before.length)
    problems.push('Nothing changed from the live price book.');
  if (earliest && (!effectiveFrom || effectiveFrom < earliest))
    problems.push(
      `A price increase needs ${INCREASE_NOTICE_DAYS} days' notice: set the effective date to ${earliest.toISOString().slice(0, 10)} or later.`,
    );
  return {
    changes,
    hasIncrease,
    earliestEffectiveFrom: earliest?.toISOString() ?? null,
    problems,
  };
}
