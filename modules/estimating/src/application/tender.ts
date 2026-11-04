import { and, asc, desc, eq, inArray, isNull, lt, max, ne } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import {
  AppError,
  decodeCursor,
  nextNumber,
  toPage,
  versionConflict,
  type TenantScope,
} from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { DocumentsApi } from '@archova/mod-documents';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import { localDateOf } from '@archova/time';
import { compareQuotes } from '../domain/comparison';
import {
  canAward,
  canSeePackage,
  isEditable,
  lowestQuote,
  nextPackageStatus,
  quoteTotals,
  takesQuotes,
  fromCents,
  toCents,
  type PackageAction,
} from '../domain/tender';
import {
  packageInvites,
  quoteLines,
  quotes,
  tenderPackages,
  type PackageDocument,
  type QuoteNote,
  type ScopeLine,
  type SourceRef,
} from '../infra/tables';

export type PackageRow = typeof tenderPackages.$inferSelect;
export type InviteRow = typeof packageInvites.$inferSelect;
export type QuoteRow = typeof quotes.$inferSelect;
export type QuoteLineRow = typeof quoteLines.$inferSelect;
export type PackageView = PackageRow & { invites: InviteRow[]; canSeeAll: boolean };
export type QuoteView = QuoteRow & { lines: QuoteLineRow[] };

export interface EstimatingDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject' | 'projectCompanies'>;
  documents: Pick<DocumentsApi, 'getDrawingRevision' | 'getDocumentRef'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  now?: () => Date;
}

export interface Viewer {
  userId: string;
  companyId: string | null;
  isInternal: boolean;
}

export interface PackageFields {
  name?: string;
  trade?: string;
  dueAt?: Date | null;
  scope?: ScopeLine[];
  documents?: PackageDocument[];
}

export interface LineInput {
  id?: string;
  scopeKey?: string | null;
  description: string;
  quantity?: string | null;
  unit?: string;
  rate?: string | null;
  amount: string;
  isProvisional?: boolean;
  source?: SourceRef | null;
}
export interface NoteInput {
  id?: string;
  text: string;
  scopeKey?: string | null;
  source?: SourceRef | null;
}
export interface QuoteInput {
  companyId?: string;
  reference?: string | null;
  fileIds?: string[];
  validUntil?: string | null;
  lines?: LineInput[];
  exclusions?: NoteInput[];
  qualifications?: NoteInput[];
  /** The Nova reading this quote was made from (ai.ai_suggestions); builder staff only. */
  aiSuggestionId?: string;
}

export function createTenderService(deps: EstimatingDeps) {
  const now = deps.now ?? (() => new Date());

  async function viewer(scope: TenantScope, projectId: string): Promise<Viewer> {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return {
      userId: scope.ctx.userId,
      companyId: perms.companyId,
      isInternal: scope.ctx.principalType === 'member',
    };
  }

  async function invitesFor(scope: TenantScope, ids: string[], v: Viewer): Promise<InviteRow[]> {
    if (!ids.length) return [];
    const conditions = [inArray(packageInvites.packageId, ids)];
    if (!v.isInternal) conditions.push(eq(packageInvites.companyId, v.companyId ?? uuidv7()));
    return scope.tx
      .select()
      .from(packageInvites)
      .where(and(...conditions))
      .orderBy(asc(packageInvites.invitedAt), asc(packageInvites.id));
  }

  const toView = (r: PackageRow, all: InviteRow[], v: Viewer): PackageView => ({
    ...r,
    invites: all.filter((i) => i.packageId === r.id),
    canSeeAll: v.isInternal,
    // Allowances and the award are the estimator's working; a subcontractor sees neither.
    allowances: v.isInternal ? r.allowances : {},
    awardedQuoteId: v.isInternal ? r.awardedQuoteId : null,
    awardedBy: v.isInternal ? r.awardedBy : null,
    awardedAt: v.isInternal ? r.awardedAt : null,
    awardReason: v.isInternal ? r.awardReason : null,
    awardNotLowest: v.isInternal ? r.awardNotLowest : null,
  });

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { status?: PackageRow['status']; limit: number; cursor?: string },
  ) {
    const v = await viewer(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions = [eq(tenderPackages.projectId, projectId), isNull(tenderPackages.deletedAt)];
    if (opts.status) conditions.push(eq(tenderPackages.status, opts.status));
    if (!v.isInternal) {
      if (!v.companyId) return { data: [], nextCursor: null };
      const invited = scope.tx
        .select({ id: packageInvites.packageId })
        .from(packageInvites)
        .where(eq(packageInvites.companyId, v.companyId));
      conditions.push(inArray(tenderPackages.id, invited), ne(tenderPackages.status, 'draft'));
    }
    if (after) conditions.push(lt(tenderPackages.id, after.id));
    const rows = await scope.tx
      .select()
      .from(tenderPackages)
      .where(and(...conditions))
      .orderBy(desc(tenderPackages.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ id: r.id }));
    const invites = await invitesFor(
      scope,
      page.data.map((r) => r.id),
      v,
    );
    return {
      data: page.data.map((r) => toView(r, invites, v)),
      nextCursor: page.nextCursor,
    };
  }

  async function load(scope: TenantScope, projectId: string, packageId: string) {
    const [row] = await scope.tx
      .select()
      .from(tenderPackages)
      .where(
        and(
          eq(tenderPackages.id, packageId),
          eq(tenderPackages.projectId, projectId),
          isNull(tenderPackages.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('tender.not_found');
    const v = await viewer(scope, projectId);
    const all = await scope.tx
      .select({ companyId: packageInvites.companyId })
      .from(packageInvites)
      .where(eq(packageInvites.packageId, packageId));
    if (
      !canSeePackage(
        row,
        v,
        all.map((i) => i.companyId),
      )
    )
      throw new AppError('tender.not_found');
    return { row, viewer: v };
  }

  async function get(scope: TenantScope, projectId: string, packageId: string) {
    const { row, viewer: v } = await load(scope, projectId, packageId);
    return toView(row, await invitesFor(scope, [packageId], v), v);
  }

  /** Throws unless the package can still take the change; checks the caller's version. */
  function assertVersion(row: PackageRow, expected: number) {
    if (row.version !== expected) throw versionConflict();
  }

  function validateScope(scopeLines: ScopeLine[]) {
    const seen = new Set<string>();
    for (const [i, l] of scopeLines.entries()) {
      if (seen.has(l.key))
        throw new AppError('tender.invalid_scope', 'Each scope line needs its own key.', [
          { path: `scope/${i}/key`, message: 'Duplicate key' },
        ]);
      seen.add(l.key);
    }
  }

  async function validateDocuments(scope: TenantScope, projectId: string, docs: PackageDocument[]) {
    for (const d of docs) {
      if (d.kind === 'drawing_revision') {
        const rev = await deps.documents.getDrawingRevision(scope, projectId, d.id);
        if (rev.status === 'draft') throw new AppError('drawing_revision.not_found');
      } else await deps.documents.getDocumentRef(scope, projectId, d.id);
    }
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: PackageFields & { name: string; trade: string },
  ) {
    await deps.platform.getProject(scope, projectId);
    if (input.scope) validateScope(input.scope);
    if (input.documents) await validateDocuments(scope, projectId, input.documents);
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'tender_package');
    await scope.tx.insert(tenderPackages).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      number,
      name: input.name.trim(),
      trade: input.trade.trim(),
      status: 'draft',
      dueAt: input.dueAt ?? null,
      scope: input.scope ?? [],
      documents: input.documents ?? [],
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    scope.events.add({
      type: 'estimating.package.created.v1',
      projectId,
      entityType: 'tender_package',
      entityId: id,
      entityVersion: 1,
      data: { packageId: id, number },
    });
    return get(scope, projectId, id);
  }

  async function bump(
    scope: TenantScope,
    row: PackageRow,
    expected: number,
    values: Partial<typeof tenderPackages.$inferInsert>,
  ) {
    const [updated] = await scope.tx
      .update(tenderPackages)
      .set({ ...values, version: row.version + 1, updatedBy: scope.ctx.userId, updatedAt: now() })
      .where(and(eq(tenderPackages.id, row.id), eq(tenderPackages.version, expected)))
      .returning();
    if (!updated) throw versionConflict();
    return updated;
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    expected: number,
    patch: PackageFields,
  ) {
    const { row } = await load(scope, projectId, packageId);
    assertVersion(row, expected);
    if (!isEditable(row.status))
      throw new AppError(
        'tender.invalid_state',
        `A package that is ${row.status.replace(/_/g, ' ')} can't be edited.`,
        undefined,
        { status: row.status },
      );
    if (patch.scope) validateScope(patch.scope);
    if (patch.documents) await validateDocuments(scope, projectId, patch.documents);
    const values: Partial<typeof tenderPackages.$inferInsert> = {};
    if (patch.name !== undefined) values.name = patch.name.trim();
    if (patch.trade !== undefined) values.trade = patch.trade.trim();
    if (patch.dueAt !== undefined) values.dueAt = patch.dueAt;
    if (patch.scope !== undefined) values.scope = patch.scope;
    if (patch.documents !== undefined) values.documents = patch.documents;
    const updated = await bump(scope, row, expected, values);
    scope.events.add({
      type: 'estimating.package.updated.v1',
      projectId,
      entityType: 'tender_package',
      entityId: packageId,
      entityVersion: updated.version,
      data: { packageId, changed: Object.keys(patch) },
    });
    return get(scope, projectId, packageId);
  }

  async function transition(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    expected: number,
    action: PackageAction,
  ) {
    const { row } = await load(scope, projectId, packageId);
    const next = nextPackageStatus(row.status, action);
    if (!next)
      throw new AppError(
        'tender.invalid_state',
        `A package that is ${row.status.replace(/_/g, ' ')} can't be ${action === 'send' ? 'sent' : action === 'close' ? 'closed' : action === 'reopen' ? 'reopened' : 'cancelled'}.`,
        undefined,
        { status: row.status },
      );
    assertVersion(row, expected);
    if (action === 'send') {
      const invites = await scope.tx
        .select({ id: packageInvites.id })
        .from(packageInvites)
        .where(eq(packageInvites.packageId, packageId))
        .limit(1);
      const missing: string[] = [];
      if (!row.scope.length) missing.push('scope');
      if (!row.dueAt) missing.push('dueAt');
      if (!invites.length) missing.push('invites');
      if (missing.length)
        throw new AppError(
          'tender.incomplete',
          'Add scope lines, a due date and at least one invite before sending.',
          missing.map((path) => ({ path, message: 'Required to send' })),
        );
    }
    const updated = await bump(scope, row, expected, { status: next });
    scope.events.add({
      type: `estimating.package.${action}.v1`,
      projectId,
      entityType: 'tender_package',
      entityId: packageId,
      entityVersion: updated.version,
      data: { packageId, from: row.status, to: next },
    });
    return get(scope, projectId, packageId);
  }

  async function invite(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    companyIds: string[],
  ) {
    const { row } = await load(scope, projectId, packageId);
    if (!isEditable(row.status))
      throw new AppError(
        'tender.invalid_state',
        "This package can't take new invites.",
        undefined,
        {
          status: row.status,
        },
      );
    const onProject = await deps.platform.projectCompanies(scope, projectId);
    const ids = [...new Set(companyIds)];
    for (const [i, id] of ids.entries())
      if (!onProject.some((c) => c.id === id))
        throw new AppError('tender.company_not_on_project', 'Invite companies on this project.', [
          { path: `companyIds/${i}`, message: 'Not a company on the project' },
        ]);
    await scope.tx
      .insert(packageInvites)
      .values(
        ids.map((companyId) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          packageId,
          companyId,
          createdBy: scope.ctx.userId,
        })),
      )
      .onConflictDoNothing();
    scope.events.add({
      type: 'estimating.package.invited.v1',
      projectId,
      entityType: 'tender_package',
      entityId: packageId,
      data: { packageId, companyIds: ids },
    });
    return get(scope, projectId, packageId);
  }

  async function setAllowances(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    expected: number,
    allowances: Record<string, string>,
  ) {
    const { row } = await load(scope, projectId, packageId);
    assertVersion(row, expected);
    if (!canAward(row.status))
      throw new AppError(
        'tender.invalid_state',
        'Allowances apply while quotes are being compared.',
        undefined,
        {
          status: row.status,
        },
      );
    const own = await scope.tx
      .select({ id: quotes.id })
      .from(quotes)
      .where(eq(quotes.packageId, packageId));
    for (const key of Object.keys(allowances)) {
      const [quoteId, scopeKey] = key.split(':');
      if (!own.some((q) => q.id === quoteId) || !row.scope.some((l) => l.key === scopeKey))
        throw new AppError(
          'tender.invalid_scope',
          'Allowances name a quote and a scope line on this package.',
          [{ path: `allowances/${key}`, message: 'Unknown quote or scope line' }],
        );
    }
    await bump(scope, row, expected, { allowances });
    return get(scope, projectId, packageId);
  }

  async function award(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    expected: number,
    input: { quoteId: string; reason?: string },
  ) {
    const { row } = await load(scope, projectId, packageId);
    if (!canAward(row.status))
      throw new AppError('tender.invalid_state', "This package can't be awarded now.", undefined, {
        status: row.status,
      });
    assertVersion(row, expected);
    const all = await scope.tx.select().from(quotes).where(eq(quotes.packageId, packageId));
    const chosen = all.find((q) => q.id === input.quoteId);
    if (!chosen) throw new AppError('quote.not_found');
    if (chosen.status !== 'confirmed')
      throw new AppError(
        'quote.invalid_state',
        'Confirm the quote before awarding it.',
        undefined,
        {
          status: chosen.status,
        },
      );
    const notLowest = lowestQuote(all, row.allowances) !== chosen.id;
    const reason = input.reason?.trim() || null;
    if (notLowest && !reason)
      throw new AppError('tender.reason_required', 'Say why this is not the lowest quote.', [
        { path: 'reason', message: 'Required when not the lowest quote' },
      ]);
    const updated = await bump(scope, row, expected, {
      status: 'awarded',
      awardedQuoteId: chosen.id,
      awardedBy: scope.ctx.userId,
      awardedAt: now(),
      awardReason: reason,
      awardNotLowest: notLowest,
    });
    scope.events.add({
      type: 'estimating.package.awarded.v1',
      projectId,
      entityType: 'tender_package',
      entityId: packageId,
      entityVersion: updated.version,
      data: { packageId, quoteId: chosen.id, companyId: chosen.companyId, notLowest },
    });
    return get(scope, projectId, packageId);
  }

  // ---- quotes ----

  async function withLines(scope: TenantScope, rows: QuoteRow[]): Promise<QuoteView[]> {
    if (!rows.length) return [];
    const lines = await scope.tx
      .select()
      .from(quoteLines)
      .where(
        inArray(
          quoteLines.quoteId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(quoteLines.sort));
    return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.quoteId === r.id) }));
  }

  /** Competing prices are the estimator's: builder staff need `quotes.review` to read any quote. */
  async function assertCanReadQuotes(scope: TenantScope, projectId: string, v: Viewer) {
    if (v.isInternal && !(await deps.access.can(scope, 'estimating.quotes.review', { projectId })))
      throw new AppError('access.denied', "You can't see the quotes on this package.");
  }

  async function listQuotes(scope: TenantScope, projectId: string, packageId: string) {
    const { viewer: v } = await load(scope, projectId, packageId);
    await assertCanReadQuotes(scope, projectId, v);
    const conditions = [eq(quotes.packageId, packageId)];
    if (!v.isInternal) conditions.push(eq(quotes.companyId, v.companyId ?? uuidv7()));
    const rows = await scope.tx
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(asc(quotes.receivedAt), asc(quotes.id));
    return withLines(scope, rows);
  }

  async function loadQuote(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    quoteId: string,
  ) {
    const { row: pkg, viewer: v } = await load(scope, projectId, packageId);
    const [q] = await scope.tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, quoteId), eq(quotes.packageId, packageId)))
      .limit(1);
    await assertCanReadQuotes(scope, projectId, v);
    if (!q || (!v.isInternal && q.companyId !== v.companyId)) throw new AppError('quote.not_found');
    return { pkg, quote: q, viewer: v };
  }

  async function getQuote(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    quoteId: string,
  ) {
    const { quote } = await loadQuote(scope, projectId, packageId, quoteId);
    return (await withLines(scope, [quote]))[0]!;
  }

  function checkLines(pkg: PackageRow, lines: LineInput[]) {
    for (const [i, l] of lines.entries())
      if (l.scopeKey && !pkg.scope.some((s) => s.key === l.scopeKey))
        throw new AppError(
          'quote.unknown_scope_key',
          'A line names a scope line the package does not have.',
          [{ path: `lines/${i}/scopeKey`, message: 'Not a scope line on this package' }],
        );
  }

  function checkNotes(pkg: PackageRow, field: string, notes: NoteInput[]) {
    for (const [i, n] of notes.entries())
      if (n.scopeKey && !pkg.scope.some((s) => s.key === n.scopeKey))
        throw new AppError(
          'quote.unknown_scope_key',
          'A note names a scope line the package does not have.',
          [{ path: `${field}/${i}/scopeKey`, message: 'Not a scope line on this package' }],
        );
  }

  const noteRows = (notes: NoteInput[] | undefined, keep: QuoteNote[] = []): QuoteNote[] =>
    (notes ?? []).map((n) => ({
      id: n.id && keep.some((k) => k.id === n.id) ? n.id : uuidv7(),
      text: n.text.trim(),
      scopeKey: n.scopeKey ?? null,
      source: n.source ?? null,
    }));

  async function checkFiles(scope: TenantScope, projectId: string, fileIds: string[]) {
    for (const [i, fileId] of fileIds.entries()) {
      const f = await deps.files.getFile(scope, fileId);
      if (f.projectId !== projectId || f.status !== 'ready')
        throw new AppError('file.not_in_project', 'Attach files uploaded to this project.', [
          { path: `fileIds/${i}`, message: 'Not a ready file in this project' },
        ]);
    }
  }

  async function writeLines(
    scope: TenantScope,
    quoteId: string,
    lines: LineInput[],
    existing: QuoteLineRow[],
    aiRead: boolean,
  ) {
    await scope.tx.delete(quoteLines).where(eq(quoteLines.quoteId, quoteId));
    await scope.tx.insert(quoteLines).values(
      lines.map((l, sort) => {
        const prior = l.id ? existing.find((e) => e.id === l.id) : undefined;
        const corrected = aiRead && prior && toCents(prior.amount) !== toCents(l.amount);
        return {
          id: prior?.id ?? uuidv7(),
          orgId: scope.ctx.orgId,
          quoteId,
          sort,
          scopeKey: l.scopeKey ?? null,
          description: l.description.trim(),
          quantity: l.quantity ?? null,
          unit: l.unit ?? 'item',
          rate: l.rate ?? null,
          amount: l.amount,
          isProvisional: l.isProvisional ?? false,
          originalAmount: corrected
            ? (prior!.originalAmount ?? prior!.amount)
            : (prior?.originalAmount ?? null),
          sourcePage: l.source?.page ?? null,
          sourceSnippet: l.source?.snippet ?? null,
        };
      }),
    );
  }

  async function createQuote(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    input: QuoteInput & { lines: LineInput[] },
  ) {
    const { row: pkg, viewer: v } = await load(scope, projectId, packageId);
    if (!takesQuotes(pkg.status))
      throw new AppError('tender.invalid_state', 'This package is not taking quotes.', undefined, {
        status: pkg.status,
      });
    // A subcontractor quotes for their own company; builder staff enter a quote for an invited company.
    if (v.isInternal && !(await deps.access.can(scope, 'estimating.quotes.review', { projectId })))
      throw new AppError('access.denied', "You can't enter quotes for other companies.");
    const companyId = v.isInternal ? input.companyId : (v.companyId ?? undefined);
    if (!companyId)
      throw new AppError('validation_failed', 'Say which company is quoting.', [
        { path: 'companyId', message: 'Required' },
      ]);
    if (!v.isInternal && input.companyId && input.companyId !== v.companyId)
      throw new AppError('access.denied', 'You can only quote for your own company.');
    const [invite] = await scope.tx
      .select()
      .from(packageInvites)
      .where(and(eq(packageInvites.packageId, packageId), eq(packageInvites.companyId, companyId)))
      .limit(1);
    if (!invite)
      throw new AppError('quote.company_not_invited', 'Invite the company to the package first.', [
        { path: 'companyId', message: 'Not invited' },
      ]);
    if (input.aiSuggestionId && !v.isInternal)
      throw new AppError(
        'access.denied',
        'Only builder staff can save a quote from a Nova reading.',
      );
    checkLines(pkg, input.lines);
    checkNotes(pkg, 'exclusions', input.exclusions ?? []);
    checkNotes(pkg, 'qualifications', input.qualifications ?? []);
    await checkFiles(scope, projectId, input.fileIds ?? []);

    const [maxRow] = await scope.tx
      .select({ last: max(quotes.revision) })
      .from(quotes)
      .where(and(eq(quotes.packageId, packageId), eq(quotes.companyId, companyId)));
    // EST-AC4: the earlier quote stays, marked superseded (a declined one stays declined).
    await scope.tx
      .update(quotes)
      .set({ status: 'superseded', updatedAt: now() })
      .where(
        and(
          eq(quotes.packageId, packageId),
          eq(quotes.companyId, companyId),
          inArray(quotes.status, ['reading', 'ready_to_review', 'confirmed']),
        ),
      );
    const totals = quoteTotals(input.lines.map((l) => l.amount));
    const id = uuidv7();
    await scope.tx.insert(quotes).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      packageId,
      companyId,
      revision: (maxRow?.last ?? 0) + 1,
      status: 'ready_to_review',
      reference: input.reference ?? null,
      fileIds: input.fileIds ?? [],
      receivedAt: now(),
      validUntil: input.validUntil ?? null,
      ...totals,
      exclusions: noteRows(input.exclusions),
      qualifications: noteRows(input.qualifications),
      // Read by Nova (F22): later corrections to a Nova amount keep the original (`quote_lines.original_amount`).
      source: input.aiSuggestionId ? 'ai_extracted' : 'manual',
      aiSuggestionId: input.aiSuggestionId ?? null,
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    await writeLines(scope, id, input.lines, [], false);
    await scope.tx
      .update(packageInvites)
      .set({ status: 'submitted', respondedAt: now() })
      .where(eq(packageInvites.id, invite.id));
    scope.events.add({
      type: 'estimating.quote.received.v1',
      projectId,
      entityType: 'quote',
      entityId: id,
      entityVersion: 1,
      data: {
        packageId,
        quoteId: id,
        companyId,
        revision: (maxRow?.last ?? 0) + 1,
        aiSuggestionId: input.aiSuggestionId ?? null,
      },
    });
    return getQuote(scope, projectId, packageId, id);
  }

  async function updateQuote(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    quoteId: string,
    expected: number,
    patch: QuoteInput,
  ) {
    const { pkg, quote } = await loadQuote(scope, projectId, packageId, quoteId);
    if (quote.status !== 'ready_to_review' && quote.status !== 'reading')
      throw new AppError(
        'quote.invalid_state',
        `A quote that is ${quote.status.replace(/_/g, ' ')} can't be edited.`,
        undefined,
        {
          status: quote.status,
        },
      );
    if (quote.version !== expected) throw versionConflict();
    if (patch.lines) checkLines(pkg, patch.lines);
    if (patch.exclusions) checkNotes(pkg, 'exclusions', patch.exclusions);
    if (patch.qualifications) checkNotes(pkg, 'qualifications', patch.qualifications);
    const values: Partial<typeof quotes.$inferInsert> = {};
    if (patch.reference !== undefined) values.reference = patch.reference;
    if (patch.validUntil !== undefined) values.validUntil = patch.validUntil;
    if (patch.exclusions) values.exclusions = noteRows(patch.exclusions, quote.exclusions);
    if (patch.qualifications)
      values.qualifications = noteRows(patch.qualifications, quote.qualifications);
    if (patch.lines) {
      const existing = await scope.tx
        .select()
        .from(quoteLines)
        .where(eq(quoteLines.quoteId, quoteId));
      await writeLines(scope, quoteId, patch.lines, existing, quote.source === 'ai_extracted');
      Object.assign(values, quoteTotals(patch.lines.map((l) => l.amount)));
    }
    const [updated] = await scope.tx
      .update(quotes)
      .set({ ...values, version: quote.version + 1, updatedBy: scope.ctx.userId, updatedAt: now() })
      .where(and(eq(quotes.id, quoteId), eq(quotes.version, expected)))
      .returning();
    if (!updated) throw versionConflict();
    return getQuote(scope, projectId, packageId, quoteId);
  }

  async function setQuoteStatus(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    quoteId: string,
    expected: number,
    to: 'confirmed' | 'declined',
  ) {
    const { pkg, quote } = await loadQuote(scope, projectId, packageId, quoteId);
    const from = to === 'confirmed' ? ['ready_to_review'] : ['ready_to_review', 'confirmed'];
    if (!from.includes(quote.status))
      throw new AppError(
        'quote.invalid_state',
        `A quote that is ${quote.status.replace(/_/g, ' ')} can't be ${to}.`,
        undefined,
        {
          status: quote.status,
        },
      );
    if (pkg.awardedQuoteId === quote.id)
      throw new AppError('quote.invalid_state', 'This quote was awarded.', undefined, {
        status: quote.status,
      });
    if (quote.version !== expected) throw versionConflict();
    const [updated] = await scope.tx
      .update(quotes)
      .set({
        status: to,
        ...(to === 'confirmed' ? { confirmedBy: scope.ctx.userId, confirmedAt: now() } : {}),
        version: quote.version + 1,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
      })
      .where(and(eq(quotes.id, quoteId), eq(quotes.version, expected)))
      .returning();
    if (!updated) throw versionConflict();
    scope.events.add({
      type: `estimating.quote.${to}.v1`,
      projectId,
      entityType: 'quote',
      entityId: quoteId,
      entityVersion: updated.version,
      data: { packageId, quoteId, companyId: quote.companyId },
    });
    return getQuote(scope, projectId, packageId, quoteId);
  }

  /**
   * For Nova quote reading (ai F22): the package's trade and scope lines. Builder staff only, and only while the package
   * is taking quotes, so a reading is never made for a quote that could not be saved.
   */
  async function scopeForQuoteReading(scope: TenantScope, projectId: string, packageId: string) {
    const { row, viewer: v } = await load(scope, projectId, packageId);
    if (!v.isInternal) throw new AppError('tender.not_found');
    if (!takesQuotes(row.status))
      throw new AppError('tender.invalid_state', 'This package is not taking quotes.', undefined, {
        status: row.status,
      });
    return {
      id: row.id,
      trade: row.trade,
      scope: row.scope.map((s) => ({
        key: s.key,
        description: s.description,
        quantity: s.quantity,
        unit: s.unit,
      })),
    };
  }

  /**
   * EST-AC6: the confirmed quotes side by side. Competing prices are the estimator's, so this is builder staff with
   * `quotes.review` only; a subcontractor never reaches it, not even for their own quote.
   */
  async function comparison(scope: TenantScope, projectId: string, packageId: string) {
    const { row, viewer: v } = await load(scope, projectId, packageId);
    if (!v.isInternal) throw new AppError('tender.not_found');
    await assertCanReadQuotes(scope, projectId, v);
    const confirmed = await scope.tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.packageId, packageId), eq(quotes.status, 'confirmed')))
      .orderBy(asc(quotes.receivedAt), asc(quotes.id));
    const project = await deps.platform.getProject(scope, projectId);
    const note = (n: QuoteNote) => ({ id: n.id, text: n.text, scopeKey: n.scopeKey });
    return compareQuotes({
      scope: row.scope,
      quotes: (await withLines(scope, confirmed)).map((q) => ({
        id: q.id,
        companyId: q.companyId,
        revision: q.revision,
        status: q.status,
        reference: q.reference,
        receivedAt: q.receivedAt,
        validUntil: q.validUntil,
        totalExGst: q.totalExGst,
        lines: q.lines,
        exclusions: q.exclusions.map(note),
        qualifications: q.qualifications.map(note),
      })),
      allowances: row.allowances,
      today: localDateOf(now(), project.timezone),
    });
  }

  /**
   * For Nova on the comparison (ai/10): one confirmed quote's lines, exclusions and qualifications set against the field.
   * Builder staff with `quotes.review` only. No company, contact, note or allowance leaves here: Nova sees prices and
   * terms, not who quoted or what the estimator allowed.
   */
  async function quoteForNegotiation(
    scope: TenantScope,
    projectId: string,
    packageId: string,
    quoteId: string,
  ) {
    const { row } = await load(scope, projectId, packageId);
    const cmp = await comparison(scope, projectId, packageId);
    const column = cmp.columns.find((c) => c.quoteId === quoteId);
    if (!column) throw new AppError('quote.not_found');
    const lowest = cmp.columns.reduce((m, c) => Math.min(m, toCents(c.totalExGst)), Infinity);
    return {
      trade: row.trade,
      totalExGst: column.totalExGst,
      validUntil: column.validUntil,
      validityExpired: column.validityExpired,
      unmappedLines: column.unmappedLines,
      lines: cmp.rows.map((r) => {
        const cell = r.cells.find((c) => c.quoteId === quoteId)!;
        return {
          scopeKey: r.key,
          description: r.description,
          amountExGst: cell.amountExGst,
          provisional: cell.state === 'provisional',
        };
      }),
      exclusions: column.exclusions.map((e) => e.text),
      qualifications: column.qualifications.map((q) => q.text),
      field: {
        quotes: cmp.columns.length,
        lowestExGst: fromCents(lowest),
        medianExGst: cmp.medianTotalExGst,
      },
    };
  }

  return {
    scopeForQuoteReading,
    quoteForNegotiation,
    comparison,
    list,
    get,
    create,
    update,
    transition,
    invite,
    setAllowances,
    award,
    listQuotes,
    getQuote,
    createQuote,
    updateQuote,
    confirmQuote: (s: TenantScope, p: string, k: string, q: string, v: number) =>
      setQuoteStatus(s, p, k, q, v, 'confirmed'),
    declineQuote: (s: TenantScope, p: string, k: string, q: string, v: number) =>
      setQuoteStatus(s, p, k, q, v, 'declined'),
  };
}

export type TenderService = ReturnType<typeof createTenderService>;
