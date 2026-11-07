import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { encodeId, uuidv7 } from '@archova/domain';
import { AppError, recordRetention, recordRetentionBatch, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { localDateOf } from '@archova/time';
import { fromCents, toCents } from '../domain/money';
import {
  summariseInvoices,
  type InvoiceClaimInput,
  type InvoiceSummary,
} from '../domain/commitment-invoices';
import {
  buildPaymentApplication,
  type ApplicationItemInfo,
  type PaymentApplication,
} from '../domain/payment-application';
import { renderPaymentApplicationPdf, type PdfOptions } from '../domain/payment-application-pdf';
import {
  budgetLines,
  commitmentLines,
  commitments,
  contracts,
  costCodes,
  paymentClaimLines,
  paymentClaims,
  paymentSchedules,
  sovItems,
  payments,
  variations,
} from '../infra/tables';

export type CommitmentRow = typeof commitments.$inferSelect;
export type CommitmentLineRow = typeof commitmentLines.$inferSelect;

export interface CommitmentsDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject'>;
  now?: () => Date;
}

export interface CreateCommitmentInput {
  kind: 'subcontract' | 'purchase_order';
  title: string;
  vendorCompanyId?: string | null;
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

  /**
   * Link a subcontract commitment to the contract its payment claims are made on (or clear the link with `null`).
   * The Invoices tab is a view over that contract's claims, so the contract must be a subcontract on the same
   * project, not already linked elsewhere, and (when both name one) with the commitment's vendor as its payee.
   */
  async function linkContract(
    scope: TenantScope,
    projectId: string,
    id: string,
    contractId: string | null,
  ) {
    await need(scope, 'financials.commitments.manage', projectId);
    const c = await row(scope, projectId, id);
    if (c.kind !== 'subcontract')
      throw new AppError(
        'financials.commitment.not_subcontract',
        'Only a subcontract has payment claims.',
      );
    if (c.status === 'void' || c.status === 'rejected')
      throw new AppError(
        'financials.commitment.bad_state',
        `A commitment that is ${c.status} can't be linked to a contract.`,
      );
    if (contractId) {
      const [k] = await scope.tx
        .select()
        .from(contracts)
        .where(and(eq(contracts.id, contractId), eq(contracts.projectId, projectId)))
        .limit(1);
      if (!k) throw new AppError('financials.contract.not_found');
      if (k.kind !== 'subcontract')
        throw new AppError(
          'financials.commitment.contract_kind',
          'Link a subcontract, not the head contract.',
        );
      if (c.vendorCompanyId && k.payeeCompanyId && c.vendorCompanyId !== k.payeeCompanyId)
        throw new AppError(
          'financials.commitment.contract_company',
          "The contract's payee is not this commitment's vendor.",
        );
      const [taken] = await scope.tx
        .select({ id: commitments.id })
        .from(commitments)
        .where(eq(commitments.contractId, contractId))
        .limit(1);
      if (taken && taken.id !== id)
        throw new AppError(
          'financials.commitment.contract_taken',
          'That contract is already linked to another commitment.',
        );
    }
    const [updated] = await scope.tx
      .update(commitments)
      .set({ contractId, version: c.version + 1 })
      .where(and(eq(commitments.id, id), eq(commitments.version, c.version)))
      .returning();
    if (!updated)
      throw new AppError('conflict', 'This commitment just changed. Reload and try again.');
    scope.events.add({
      type: 'financials.commitment.contract_linked.v1',
      projectId,
      entityType: 'commitment',
      entityId: id,
      entityVersion: updated.version,
      data: { commitmentId: id, contractId },
    });
    return { commitment: updated, lines: await linesOf(scope, id) };
  }

  /**
   * The Invoices tab: the linked contract's claims with the contract sum, retainage, payments and what is left.
   * Builder staff holding both commitments.read and claims.read. `linked: false` when no contract is linked yet.
   */
  async function invoicesFor(
    scope: TenantScope,
    projectId: string,
    id: string,
  ): Promise<{ linked: boolean; contractId: string | null; summary: InvoiceSummary | null }> {
    await need(scope, 'financials.commitments.read', projectId);
    await need(scope, 'financials.claims.read', projectId);
    const c = await row(scope, projectId, id);
    if (!c.contractId) return { linked: false, contractId: null, summary: null };
    const [k] = await scope.tx
      .select()
      .from(contracts)
      .where(eq(contracts.id, c.contractId))
      .limit(1);
    if (!k) return { linked: false, contractId: null, summary: null };
    const claimRows = await scope.tx
      .select()
      .from(paymentClaims)
      .where(eq(paymentClaims.contractId, k.id))
      .orderBy(asc(paymentClaims.number));
    const claimIds = claimRows.map((r) => r.id);
    const schedules = claimIds.length
      ? await scope.tx
          .select({ claimId: paymentSchedules.claimId, amount: paymentSchedules.scheduledAmount })
          .from(paymentSchedules)
          .where(inArray(paymentSchedules.claimId, claimIds))
      : [];
    const paidRows = claimIds.length
      ? await scope.tx
          .select({
            claimId: payments.claimId,
            paid: sql<string>`coalesce(sum(${payments.amount}), 0)`,
          })
          .from(payments)
          .where(inArray(payments.claimId, claimIds))
          .groupBy(payments.claimId)
      : [];
    const approved = await scope.tx
      .select({ amount: variations.amount })
      .from(variations)
      .where(and(eq(variations.contractId, k.id), eq(variations.status, 'approved')));
    const sched = new Map(schedules.map((s) => [s.claimId, s.amount]));
    const paid = new Map(paidRows.map((p) => [p.claimId, p.paid]));
    const claims: InvoiceClaimInput[] = claimRows.map((r) => ({
      id: r.id,
      number: r.number,
      periodEnd: r.periodEnd,
      receivedAt: r.receivedAt,
      status: r.status,
      claimedGross: r.claimedGross,
      lessPrevious: r.lessPrevious,
      retention: r.retention,
      claimedNet: r.claimedNet,
      scheduledAmount: sched.get(r.id) ?? null,
      paid: fromCents(toCents(paid.get(r.id) ?? '0')),
      paymentDueOn: r.paymentDueOn,
    }));
    return {
      linked: true,
      contractId: k.id,
      summary: summariseInvoices({
        originalValue: k.originalValue,
        approvedVariations: approved.map((a) => a.amount),
        claims,
      }),
    };
  }

  /**
   * One invoice (payment claim) as a payment application: schedule-of-values breakdown, totals and Nova's proofread
   * (code, not a model). Same rules as the Invoices tab, and the claim must be on the commitment's linked contract.
   */
  async function invoiceDetail(
    scope: TenantScope,
    projectId: string,
    id: string,
    claimId: string,
  ): Promise<{ application: PaymentApplication; commitmentTitle: string }> {
    await need(scope, 'financials.commitments.read', projectId);
    await need(scope, 'financials.claims.read', projectId);
    const c = await row(scope, projectId, id);
    const notFound = () => new AppError('financials.claim.not_found');
    if (!c.contractId) throw notFound();
    const [claim] = await scope.tx
      .select()
      .from(paymentClaims)
      .where(
        and(
          eq(paymentClaims.id, claimId),
          eq(paymentClaims.contractId, c.contractId),
          eq(paymentClaims.projectId, projectId),
        ),
      )
      .limit(1);
    if (!claim) throw notFound();
    const [k] = await scope.tx
      .select()
      .from(contracts)
      .where(eq(contracts.id, c.contractId))
      .limit(1);
    if (!k) throw notFound();
    const lines = await scope.tx
      .select()
      .from(paymentClaimLines)
      .where(eq(paymentClaimLines.claimId, claimId));
    const [priorClaim] = await scope.tx
      .select()
      .from(paymentClaims)
      .where(
        and(
          eq(paymentClaims.contractId, k.id),
          sql`${paymentClaims.number} < ${claim.number}`,
          sql`${paymentClaims.status} <> 'withdrawn'`,
        ),
      )
      .orderBy(desc(paymentClaims.number))
      .limit(1);
    const priorLines = priorClaim
      ? await scope.tx
          .select()
          .from(paymentClaimLines)
          .where(eq(paymentClaimLines.claimId, priorClaim.id))
      : [];
    const sov = await scope.tx.select().from(sovItems).where(eq(sovItems.contractId, k.id));
    const vars = await scope.tx.select().from(variations).where(eq(variations.contractId, k.id));
    const items = new Map<string, ApplicationItemInfo>();
    const codeIds = sov.flatMap((i) => (i.costCodeId ? [i.costCodeId] : []));
    const codes = codeIds.length
      ? await scope.tx
          .select({ id: costCodes.id, code: costCodes.code })
          .from(costCodes)
          .where(inArray(costCodes.id, codeIds))
      : [];
    const codeOf = new Map(codes.map((c) => [c.id, c.code]));
    for (const i of sov)
      items.set(i.id, {
        code: i.code,
        description: i.description,
        value: i.value,
        kind: 'sov',
        costCode: i.costCodeId ? (codeOf.get(i.costCodeId) ?? null) : null,
      });
    for (const v of vars)
      items.set(v.id, {
        code: `V${v.number}`,
        description: v.title,
        value: v.amount,
        kind: 'variation',
      });
    const [sched] = await scope.tx
      .select({ amount: paymentSchedules.scheduledAmount })
      .from(paymentSchedules)
      .where(eq(paymentSchedules.claimId, claimId))
      .limit(1);
    const [paidRow] = await scope.tx
      .select({ paid: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(eq(payments.claimId, claimId));
    const today = localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);
    const application = buildPaymentApplication({
      contract: {
        number: k.number,
        title: k.title,
        retentionPct: k.retentionPct,
        retentionCapPct: k.retentionCapPct,
        originalValue: k.originalValue,
      },
      items,
      approvedVariations: vars
        .filter((v) => v.status === 'approved')
        .map((v) => ({
          amount: v.amount,
          decidedOn: v.decidedAt ? v.decidedAt.toISOString().slice(0, 10) : null,
        })),
      claim: {
        id: claim.id,
        number: claim.number,
        periodEnd: claim.periodEnd,
        receivedAt: claim.receivedAt,
        status: claim.status,
        claimedGross: claim.claimedGross,
        lessPrevious: claim.lessPrevious,
        retention: claim.retention,
        claimedNet: claim.claimedNet,
        gst: claim.gst,
        claimedTotal: claim.claimedTotal,
        paymentDueOn: claim.paymentDueOn,
        scheduleDueOn: claim.scheduleDueOn,
        scheduledAmount: sched?.amount ?? null,
        paid: fromCents(toCents(paidRow?.paid ?? '0')),
      },
      lines: lines.map((l) => ({
        sovItemId: l.sovItemId,
        variationId: l.variationId,
        previous: l.previous,
        thisClaim: l.thisClaim,
        toDate: l.toDate,
      })),
      prior: priorClaim
        ? {
            number: priorClaim.number,
            periodEnd: priorClaim.periodEnd,
            claimedGross: priorClaim.claimedGross,
            lessPrevious: priorClaim.lessPrevious,
            lines: priorLines.map((l) => ({
              sovItemId: l.sovItemId,
              variationId: l.variationId,
              toDate: l.toDate,
            })),
          }
        : null,
      today,
    });
    return { application, commitmentTitle: c.title };
  }

  /** The payment application as a PDF, with the sections, columns, paper and notes the person chose. */
  async function invoicePdf(
    scope: TenantScope,
    projectId: string,
    id: string,
    claimId: string,
    options: PdfOptions,
  ) {
    const { application, commitmentTitle } = await invoiceDetail(scope, projectId, id, claimId);
    const bytes = await renderPaymentApplicationPdf(application, options, { commitmentTitle });
    return {
      filename: `payment-application-${application.claimNumber}.pdf`,
      contentType: 'application/pdf' as const,
      dataBase64: Buffer.from(bytes).toString('base64'),
    };
  }

  return {
    linkContract,
    invoicesFor,
    invoiceDetail,
    invoicePdf,
    createCommitment,
    commitmentForQuote,
    listCommitments,
    getCommitment,
    moveCommitment,
  };
}

export type CommitmentsService = ReturnType<typeof createCommitmentsService>;
