import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { encodeId, uuidv7 } from '@archova/domain';
import { AppError, recordRetention, recordRetentionBatch, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { fromCents, toCents } from '../domain/money';
import { attachChangeEvent } from './changeEvents';
import { budgetLines, commitmentLines, commitments } from '../infra/tables';

export type CommitmentRow = typeof commitments.$inferSelect;
export type CommitmentLineRow = typeof commitmentLines.$inferSelect;

export interface CommitmentsDeps {
  access: AccessService;
  now?: () => Date;
}

export interface CreateCommitmentInput {
  kind: 'subcontract' | 'purchase_order';
  title: string;
  vendorCompanyId?: string | null;
  /** The change event this commitment prices; moves it to converted_to_commitment. */
  changeEventId?: string;
  lines: { budgetLineId: string; description: string; amount: string }[];
  /** Set when raised from an awarded tender quote; one quote raises at most one commitment. */
  source?: { packageId: string; quoteId: string };
}

export type CommitmentMove = 'submitted' | 'approved' | 'rejected' | 'void';

const ALLOWED_FROM: Record<CommitmentMove, string[]> = {
  submitted: ['draft'],
  approved: ['submitted'],
  rejected: ['submitted'],
  void: ['draft', 'submitted', 'approved'],
};

/**
 * Commitments: the subcontracts and purchase orders a builder places against the project budget. Internal cost
 * control, builder staff only. Committed cost on a budget line is the sum of its lines on *approved* commitments;
 * an approval that would take a line past its budget needs an explicit override.
 */
export function createCommitmentsService(deps: CommitmentsDeps) {
  const now = deps.now ?? (() => new Date());

  const need = async (scope: TenantScope, key: string, projectId: string) => {
    await deps.access.assert(scope, key, { projectId });
    if (scope.ctx.principalType !== 'member')
      throw new AppError('access.denied', "Only the builder's staff can work with commitments.");
  };

  async function linesOf(scope: TenantScope, commitmentId: string) {
    return scope.tx
      .select()
      .from(commitmentLines)
      .where(eq(commitmentLines.commitmentId, commitmentId))
      .orderBy(asc(commitmentLines.sort));
  }

  async function row(scope: TenantScope, projectId: string, id: string) {
    const [r] = await scope.tx
      .select()
      .from(commitments)
      .where(and(eq(commitments.id, id), eq(commitments.projectId, projectId)))
      .limit(1);
    if (!r) throw new AppError('financials.commitment.not_found');
    return r;
  }

  async function createCommitment(
    scope: TenantScope,
    projectId: string,
    input: CreateCommitmentInput,
  ) {
    await need(scope, 'financials.commitments.manage', projectId);
    if (!input.lines.length)
      throw new AppError('validation_failed', 'Add at least one line.', [
        { path: 'lines', message: 'Required' },
      ]);
    input.lines.forEach((l, i) => {
      if (toCents(l.amount) <= 0)
        throw new AppError('validation_failed', 'Each line must be for more than zero.', [
          { path: `lines/${i}/amount`, message: 'Must be more than zero' },
        ]);
    });
    const ids = [...new Set(input.lines.map((l) => l.budgetLineId))];
    const found = await scope.tx
      .select({ id: budgetLines.id })
      .from(budgetLines)
      .where(and(eq(budgetLines.projectId, projectId), inArray(budgetLines.id, ids)));
    if (found.length !== ids.length)
      throw new AppError(
        'financials.budget.line_not_found',
        'A budget line is not on this project.',
      );
    if (input.changeEventId)
      await attachChangeEvent(scope, projectId, input.changeEventId, 'converted_to_commitment');
    // Serialise numbering per project.
    await scope.tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'commitments:' + projectId}, 0))`,
    );
    const [n] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${commitments.number}), 0) + 1` })
      .from(commitments)
      .where(eq(commitments.projectId, projectId));
    const id = uuidv7();
    const total = input.lines.reduce((s, l) => s + toCents(l.amount), 0);
    const [created] = await scope.tx
      .insert(commitments)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number: Number(n!.n),
        kind: input.kind,
        title: input.title.trim(),
        vendorCompanyId: input.vendorCompanyId ?? null,
        changeEventId: input.changeEventId ?? null,
        total: fromCents(total),
        sourcePackageId: input.source?.packageId ?? null,
        sourceQuoteId: input.source?.quoteId ?? null,
        createdBy: scope.ctx.userId,
      })
      .returning();
    const lineRows = input.lines.map((l, sort) => ({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      commitmentId: id,
      budgetLineId: l.budgetLineId,
      description: l.description.trim(),
      amount: l.amount,
      sort,
    }));
    const inserted = await scope.tx.insert(commitmentLines).values(lineRows).returning();
    await recordRetention(scope, {
      recordType: 'financials.commitments',
      recordId: id,
      projectId,
      category: 'financial_7y',
      anchor: created!.createdAt,
    });
    await recordRetentionBatch(
      scope,
      'financials.commitment_lines',
      'financial_7y',
      created!.createdAt,
      inserted.map((l) => ({ recordId: l.id, projectId })),
    );
    return { commitment: created!, lines: inserted };
  }

  /** The commitment already raised from this quote, if any (read by the award flow to stay idempotent). */
  async function commitmentForQuote(scope: TenantScope, projectId: string, quoteId: string) {
    await need(scope, 'financials.commitments.read', projectId);
    const [r] = await scope.tx
      .select()
      .from(commitments)
      .where(and(eq(commitments.projectId, projectId), eq(commitments.sourceQuoteId, quoteId)))
      .limit(1);
    return r ?? null;
  }

  async function listCommitments(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.commitments.read', projectId);
    return scope.tx
      .select()
      .from(commitments)
      .where(eq(commitments.projectId, projectId))
      .orderBy(desc(commitments.number));
  }

  async function getCommitment(scope: TenantScope, projectId: string, id: string) {
    await need(scope, 'financials.commitments.read', projectId);
    const c = await row(scope, projectId, id);
    return { commitment: c, lines: await linesOf(scope, id) };
  }

  async function moveCommitment(
    scope: TenantScope,
    projectId: string,
    id: string,
    to: CommitmentMove,
    opts: { note?: string; allowOverBudget?: boolean } = {},
  ) {
    const decide = to === 'approved' || to === 'rejected';
    await need(
      scope,
      decide ? 'financials.commitments.decide' : 'financials.commitments.manage',
      projectId,
    );
    const c = await row(scope, projectId, id);
    if (!ALLOWED_FROM[to].includes(c.status))
      throw new AppError(
        'financials.commitment.bad_state',
        `A commitment that is ${c.status} can't be ${to === 'void' ? 'voided' : to}.`,
      );
    if ((to === 'rejected' || to === 'void') && c.status !== 'draft' && !(opts.note ?? '').trim())
      throw new AppError(
        'financials.commitment.reason_required',
        `Give the reason for ${to === 'void' ? 'voiding' : 'rejecting'} this commitment.`,
        [{ path: 'note', message: 'Required' }],
      );
    const lines = await linesOf(scope, id);
    let override = false;
    // Approving adds to the budget lines' committed cost and voiding an approved commitment takes it back. The lines
    // are locked first (in id order) so two moves cannot both pass a limit only one of them fits under.
    const sign = to === 'approved' ? 1 : to === 'void' && c.status === 'approved' ? -1 : 0;
    if (sign !== 0) {
      const delta = new Map<string, number>();
      for (const l of lines)
        delta.set(l.budgetLineId, (delta.get(l.budgetLineId) ?? 0) + toCents(l.amount));
      const budgets = await scope.tx
        .select()
        .from(budgetLines)
        .where(inArray(budgetLines.id, [...delta.keys()]))
        .orderBy(asc(budgetLines.id))
        .for('update');
      if (sign === 1) {
        const over = budgets.filter(
          (b) =>
            toCents(b.committed) + delta.get(b.id)! >
            toCents(b.original) + toCents(b.approvedChanges),
        );
        if (over.length) {
          if (!opts.allowOverBudget)
            throw new AppError(
              'financials.commitment.over_budget',
              'Approving this would take a budget line past its budget.',
              over.map((b) => ({
                path: `budgetLines/${encodeId('budgetLine', b.id)}`,
                message: 'Over budget',
              })),
            );
          if (!(opts.note ?? '').trim())
            throw new AppError(
              'financials.commitment.reason_required',
              'Give the reason for approving over budget.',
              [{ path: 'note', message: 'Required when approving over budget' }],
            );
          override = true;
        }
      }
      for (const b of budgets)
        await scope.tx
          .update(budgetLines)
          .set({ committed: fromCents(toCents(b.committed) + sign * delta.get(b.id)!) })
          .where(eq(budgetLines.id, b.id));
    }
    const at = now();
    const [updated] = await scope.tx
      .update(commitments)
      .set({
        status: to,
        version: c.version + 1,
        ...(to === 'submitted' ? { submittedAt: at, submittedBy: scope.ctx.userId } : {}),
        ...(decide || to === 'void'
          ? {
              decidedAt: at,
              decidedBy: scope.ctx.userId,
              decisionNote: opts.note?.trim() || null,
              ...(override ? { overBudgetOverride: true } : {}),
            }
          : {}),
      })
      .where(and(eq(commitments.id, id), eq(commitments.version, c.version)))
      .returning();
    if (!updated)
      throw new AppError('conflict', 'This commitment just changed. Reload and try again.');
    scope.events.add({
      type: `financials.commitment.${to}.v1`,
      projectId,
      entityType: 'commitment',
      entityId: id,
      entityVersion: updated.version,
      data: { commitmentId: id, number: c.number, kind: c.kind, total: c.total },
    });
    return { commitment: updated, lines };
  }

  /** For `logistics`: the purchase orders on a project, so a delivery can name the order it fulfils. No permission check; the caller has its own. */
  async function purchaseOrderRef(scope: TenantScope, projectId: string, id: string) {
    const [r] = await scope.tx
      .select({
        id: commitments.id,
        number: commitments.number,
        title: commitments.title,
        kind: commitments.kind,
        vendorCompanyId: commitments.vendorCompanyId,
      })
      .from(commitments)
      .where(and(eq(commitments.id, id), eq(commitments.projectId, projectId)))
      .limit(1);
    return r && r.kind === 'purchase_order' ? r : null;
  }

  return {
    purchaseOrderRef,
    createCommitment,
    commitmentForQuote,
    listCommitments,
    getCommitment,
    moveCommitment,
  };
}

export type CommitmentsService = ReturnType<typeof createCommitmentsService>;
