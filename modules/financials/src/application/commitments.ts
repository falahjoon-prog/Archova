import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, recordRetention, recordRetentionBatch, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { fromCents, toCents } from '../domain/money';
import { budgetLines, commitmentLines, commitments } from '../infra/tables';

export type BudgetLineRow = typeof budgetLines.$inferSelect;
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
  lines: { budgetLineId: string; description: string; amount: string }[];
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

  /** Committed cents per budget line, approved commitments only. */
  async function committedByLine(scope: TenantScope, projectId: string, lineIds?: string[]) {
    const rows = await scope.tx
      .select({
        id: commitmentLines.budgetLineId,
        total: sql<string>`coalesce(sum(${commitmentLines.amount}), 0)`,
      })
      .from(commitmentLines)
      .innerJoin(commitments, eq(commitments.id, commitmentLines.commitmentId))
      .where(
        and(
          eq(commitments.projectId, projectId),
          eq(commitments.status, 'approved'),
          lineIds ? inArray(commitmentLines.budgetLineId, lineIds) : undefined,
        ),
      )
      .groupBy(commitmentLines.budgetLineId);
    return new Map(rows.map((r) => [r.id, toCents(r.total)]));
  }

  async function listBudgetLines(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.commitments.read', projectId);
    const rows = await scope.tx
      .select()
      .from(budgetLines)
      .where(eq(budgetLines.projectId, projectId))
      .orderBy(asc(budgetLines.code));
    const committed = await committedByLine(scope, projectId);
    const lines = rows.map((r) => {
      const c = committed.get(r.id) ?? 0;
      return { line: r, committed: fromCents(c), uncommitted: fromCents(toCents(r.budget) - c) };
    });
    const totalBudget = rows.reduce((n, r) => n + toCents(r.budget), 0);
    const totalCommitted = [...committed.values()].reduce((n, c) => n + c, 0);
    return {
      lines,
      totals: {
        budget: fromCents(totalBudget),
        committed: fromCents(totalCommitted),
        uncommitted: fromCents(totalBudget - totalCommitted),
      },
    };
  }

  async function createBudgetLine(
    scope: TenantScope,
    projectId: string,
    input: { code: string; description: string; budget: string },
  ) {
    await need(scope, 'financials.budget.manage', projectId);
    const code = input.code.trim();
    const [dup] = await scope.tx
      .select({ id: budgetLines.id })
      .from(budgetLines)
      .where(and(eq(budgetLines.projectId, projectId), eq(budgetLines.code, code)))
      .limit(1);
    if (dup)
      throw new AppError('financials.budget_line.duplicate_code', `Budget code ${code} is in use.`);
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(budgetLines)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        code,
        description: input.description.trim(),
        budget: input.budget,
        createdBy: scope.ctx.userId,
      })
      .onConflictDoNothing()
      .returning();
    // A concurrent create of the same code loses on the unique index.
    if (!row)
      throw new AppError('financials.budget_line.duplicate_code', `Budget code ${code} is in use.`);
    await recordRetention(scope, {
      recordType: 'financials.budget_lines',
      recordId: id,
      projectId,
      category: 'financial_7y',
      anchor: row.createdAt,
    });
    return { line: row, committed: '0.00', uncommitted: row.budget };
  }

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
        'financials.budget_line.not_found',
        'A budget line is not on this project.',
      );
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
        total: fromCents(total),
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
    if (to === 'approved') {
      // Lock the budget lines so two approvals cannot both pass a limit only one of them fits under.
      const lineIds = [...new Set(lines.map((l) => l.budgetLineId))].sort();
      const budgets = await scope.tx
        .select()
        .from(budgetLines)
        .where(inArray(budgetLines.id, lineIds))
        .orderBy(asc(budgetLines.id))
        .for('update');
      const committed = await committedByLine(scope, projectId, lineIds);
      const adding = new Map<string, number>();
      for (const l of lines)
        adding.set(l.budgetLineId, (adding.get(l.budgetLineId) ?? 0) + toCents(l.amount));
      const over = budgets.filter(
        (b) => (committed.get(b.id) ?? 0) + (adding.get(b.id) ?? 0) > toCents(b.budget),
      );
      if (over.length) {
        if (!opts.allowOverBudget)
          throw new AppError(
            'financials.commitment.over_budget',
            `Approving this would take ${over.map((b) => b.code).join(', ')} past budget.`,
            over.map((b) => ({ path: `budgetLines/${b.code}`, message: 'Over budget' })),
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

  return {
    listBudgetLines,
    createBudgetLine,
    createCommitment,
    listCommitments,
    getCommitment,
    moveCommitment,
  };
}

export type CommitmentsService = ReturnType<typeof createCommitmentsService>;
