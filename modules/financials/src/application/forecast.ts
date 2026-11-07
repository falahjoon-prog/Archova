import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { computeForecast, type HeadInput } from '../domain/forecast';
import { toCents } from '../domain/money';
import {
  budgetLines,
  contracts,
  costCodes,
  directCosts,
  forecastAdjustments,
  paymentClaimLines,
  paymentClaims,
  sovItems,
  variations,
} from '../infra/tables';

export type AdjustmentRow = typeof forecastAdjustments.$inferSelect;

export interface CreateAdjustmentInput {
  contractId?: string | null;
  category: AdjustmentRow['category'];
  label: string;
  costCodeId?: string | null;
  note?: string;
  /** Signed, ex GST, not zero. */
  amount: string;
}

const signedCents = (v: string) => (v.startsWith('-') ? -toCents(v.slice(1)) : toCents(v));
const SIGNED = /^-?\d{1,16}(\.\d{1,2})?$/;

// Contracts have no execute step yet (they are created draft and claimed against), so every contract that has not
// been terminated counts as a commitment.
export function createForecastService(deps: { access: AccessService }) {
  // The forecast shows the builder's margin, so it is builder-staff and admin-level only.
  async function need(scope: TenantScope, key: string, projectId: string) {
    await deps.access.assert(scope, key, { projectId });
    if (scope.ctx.principalType !== 'member')
      throw new AppError('access.denied', "Only the builder's staff can see the cost forecast.");
  }

  async function adjustments(scope: TenantScope, projectId: string) {
    return scope.tx
      .select()
      .from(forecastAdjustments)
      .where(eq(forecastAdjustments.projectId, projectId))
      .orderBy(asc(forecastAdjustments.createdAt), asc(forecastAdjustments.id));
  }

  async function costForecast(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.forecast.read', projectId);
    const live = await scope.tx
      .select()
      .from(contracts)
      .where(and(eq(contracts.projectId, projectId), ne(contracts.status, 'terminated')))
      .orderBy(asc(contracts.number));
    const ids = live.map((c) => c.id);
    const varRows = ids.length
      ? await scope.tx
          .select({
            contractId: variations.contractId,
            status: variations.status,
            total: sql<string>`coalesce(sum(${variations.amount}), 0)`,
          })
          .from(variations)
          .where(
            and(
              inArray(variations.contractId, ids),
              inArray(variations.status, ['approved', 'submitted']),
            ),
          )
          .groupBy(variations.contractId, variations.status)
      : [];
    const claimRows = ids.length
      ? await scope.tx
          .select({
            contractId: paymentClaims.contractId,
            total: sql<string>`coalesce(sum(${paymentClaimLines.thisClaim}), 0)`,
          })
          .from(paymentClaimLines)
          .innerJoin(paymentClaims, eq(paymentClaims.id, paymentClaimLines.claimId))
          .where(
            and(
              inArray(paymentClaims.contractId, ids),
              eq(paymentClaims.isValid, true),
              ne(paymentClaims.status, 'withdrawn'),
            ),
          )
          .groupBy(paymentClaims.contractId)
      : [];
    const v = (id: string, status: string) =>
      toCents(varRows.find((r) => r.contractId === id && r.status === status)?.total ?? '0');
    const claimed = (id: string) =>
      toCents(claimRows.find((r) => r.contractId === id)?.total ?? '0');
    const input = (c: (typeof live)[number]) => ({
      originalCents: toCents(c.originalValue),
      approvedVariationCents: v(c.id, 'approved'),
      pendingVariationCents: v(c.id, 'submitted'),
      claimedCents: claimed(c.id),
    });
    const subs = live.filter((c) => c.kind === 'subcontract');
    const heads: HeadInput[] = live.filter((c) => c.kind === 'head').map(input);
    const adj = await adjustments(scope, projectId);
    const result = computeForecast(
      subs.map((c) => ({ contractId: c.id, ...input(c) })),
      heads,
      adj.map((a) => ({ contractId: a.contractId, amountCents: signedCents(a.amount) })),
      (await directByCode(scope, projectId)).reduce((n, d) => n + d.amountCents, 0),
    );
    return { result, subs, adjustments: adj };
  }

  /** Recorded (not voided) direct costs, per cost code of the budget line they were posted to. */
  async function directByCode(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select({
        costCodeId: budgetLines.costCodeId,
        total: sql<string>`coalesce(sum(${directCosts.amount}), 0)`,
      })
      .from(directCosts)
      .innerJoin(budgetLines, eq(budgetLines.id, directCosts.budgetLineId))
      .where(and(eq(directCosts.projectId, projectId), eq(directCosts.status, 'recorded')))
      .groupBy(budgetLines.costCodeId);
    return rows.map((r) => ({ costCodeId: r.costCodeId, amountCents: toCents(r.total) }));
  }

  /** Subcontract commitments with their schedule items, and adjustments, for the budget-vs-forecast comparison. */
  async function inputsByCode(scope: TenantScope, projectId: string) {
    const subs = await scope.tx
      .select()
      .from(contracts)
      .where(
        and(
          eq(contracts.projectId, projectId),
          eq(contracts.kind, 'subcontract'),
          ne(contracts.status, 'terminated'),
        ),
      );
    const ids = subs.map((c) => c.id);
    const [vars, claims, items] = ids.length
      ? await Promise.all([
          scope.tx
            .select({
              id: variations.id,
              contractId: variations.contractId,
              costCodeId: variations.costCodeId,
              amount: variations.amount,
            })
            .from(variations)
            .where(and(inArray(variations.contractId, ids), eq(variations.status, 'approved'))),
          scope.tx
            .select({
              contractId: paymentClaims.contractId,
              sovItemId: paymentClaimLines.sovItemId,
              variationId: paymentClaimLines.variationId,
              total: sql<string>`coalesce(sum(${paymentClaimLines.thisClaim}), 0)`,
            })
            .from(paymentClaimLines)
            .innerJoin(paymentClaims, eq(paymentClaims.id, paymentClaimLines.claimId))
            .where(
              and(
                inArray(paymentClaims.contractId, ids),
                eq(paymentClaims.isValid, true),
                ne(paymentClaims.status, 'withdrawn'),
              ),
            )
            .groupBy(
              paymentClaims.contractId,
              paymentClaimLines.sovItemId,
              paymentClaimLines.variationId,
            ),
          scope.tx.select().from(sovItems).where(inArray(sovItems.contractId, ids)),
        ])
      : [[], [], []];
    const adj = await adjustments(scope, projectId);
    return {
      direct: await directByCode(scope, projectId),
      subs: subs.map((c) => {
        const mine = claims.filter((r) => r.contractId === c.id);
        const myVars = vars.filter((v) => v.contractId === c.id);
        return {
          committedCents:
            toCents(c.originalValue) + myVars.reduce((n, v) => n + toCents(v.amount), 0),
          claimedCents: mine.reduce((n, r) => n + toCents(r.total), 0),
          items: items
            .filter((i) => i.contractId === c.id)
            .map((i) => ({
              costCodeId: i.costCodeId,
              valueCents: toCents(i.value),
              claimedCents: toCents(mine.find((r) => r.sovItemId === i.id)?.total ?? '0'),
            }))
            // An approved variation coded to a cost code counts as committed work on that code.
            .concat(
              myVars
                .filter((v) => v.costCodeId !== null)
                .map((v) => ({
                  costCodeId: v.costCodeId,
                  valueCents: toCents(v.amount),
                  claimedCents: toCents(mine.find((r) => r.variationId === v.id)?.total ?? '0'),
                })),
            ),
        };
      }),
      adjustments: adj.map((a) => ({
        costCodeId: a.costCodeId,
        amountCents: signedCents(a.amount),
      })),
    };
  }

  async function createAdjustment(
    scope: TenantScope,
    projectId: string,
    input: CreateAdjustmentInput,
  ) {
    await need(scope, 'financials.forecast.manage', projectId);
    if (!SIGNED.test(input.amount) || signedCents(input.amount) === 0)
      throw new AppError('validation_failed', 'Invalid amount', [
        { path: 'amount', message: 'Must be a non-zero amount' },
      ]);
    if (input.contractId) {
      const [c] = await scope.tx
        .select({ id: contracts.id, kind: contracts.kind })
        .from(contracts)
        .where(and(eq(contracts.id, input.contractId), eq(contracts.projectId, projectId)));
      if (!c || c.kind !== 'subcontract')
        throw new AppError('validation_failed', 'Not a subcontract on this project', [
          { path: 'contractId', message: 'Must be a subcontract on this project' },
        ]);
    }
    if (input.costCodeId) {
      const [cc] = await scope.tx
        .select({ id: costCodes.id })
        .from(costCodes)
        .where(and(eq(costCodes.id, input.costCodeId), eq(costCodes.projectId, projectId)));
      if (!cc)
        throw new AppError(
          'financials.cost_code.not_found',
          'That cost code is not on this project.',
        );
    }
    const [row] = await scope.tx
      .insert(forecastAdjustments)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        contractId: input.contractId ?? null,
        costCodeId: input.costCodeId ?? null,
        category: input.category,
        label: input.label,
        note: input.note ?? null,
        amount: input.amount,
        createdBy: scope.ctx.userId,
      })
      .returning();
    return row!;
  }

  async function deleteAdjustment(scope: TenantScope, projectId: string, id: string) {
    await need(scope, 'financials.forecast.manage', projectId);
    const gone = await scope.tx
      .delete(forecastAdjustments)
      .where(and(eq(forecastAdjustments.id, id), eq(forecastAdjustments.projectId, projectId)))
      .returning({ id: forecastAdjustments.id });
    if (gone.length === 0) throw new AppError('financials.forecast_adjustment.not_found');
  }

  return { costForecast, inputsByCode, createAdjustment, deleteAdjustment };
}

export type ForecastService = ReturnType<typeof createForecastService>;
