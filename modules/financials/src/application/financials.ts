import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import {
  SOPA_RULES,
  computeDeadlines,
  ruleInForce,
  uuidv7,
  type ContractKind,
  type SopaState,
} from '@archova/domain';
import { localDateOf } from '@archova/time';
import { AppError, nextNumber, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { claimTotals, describeClaimError, isClaimError } from '../domain/claim';
import { PUBLIC_HOLIDAYS } from '../domain/holidays';
import { fromCents, toCents } from '../domain/money';
import {
  contracts,
  paymentClaimLines,
  paymentClaims,
  paymentSchedules,
  sovItems,
} from '../infra/tables';

export type ContractRow = typeof contracts.$inferSelect;
export type SovRow = typeof sovItems.$inferSelect;
export type ClaimRow = typeof paymentClaims.$inferSelect;
export type ClaimLineRow = typeof paymentClaimLines.$inferSelect;
export type ScheduleRow = typeof paymentSchedules.$inferSelect;

export interface FinancialsDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject'>;
  now?: () => Date;
}

export interface CreateContractInput {
  kind: ContractKind;
  title: string;
  payerCompanyId?: string | null;
  payeeCompanyId?: string | null;
  originalValue: string;
  retentionPct?: string;
  retentionCapPct?: string | null;
  sopaState?: ContractRow['sopaState'];
  scheduleDays?: number | null;
  paymentDays?: number | null;
  sov: { code: string; description: string; value: string }[];
}

export interface SubmitClaimInput {
  periodEnd: string;
  receivedAt: Date;
  statesAct: boolean;
  lines: { sovItemId: string; thisClaim: string }[];
}

export interface IssueScheduleInput {
  scheduledAmount: string;
  overallReason?: string;
  lineReasons?: { sovItemId: string; reason: string }[];
}

const GST_TOTAL = (c: ClaimRow) => toCents(c.claimedTotal);

export function createFinancialsService(deps: FinancialsDeps) {
  const now = deps.now ?? (() => new Date());

  const need = (scope: TenantScope, key: string, projectId: string) =>
    deps.access.assert(scope, key, { projectId });

  /**
   * CLM-AC11: a subcontractor only ever sees contracts where their company is the payee. Builder staff (members) see
   * all. Recording a claim for the builder to assess is staff work for now; a subcontractor submitting through the
   * platform is a later increment with its own service-time rules.
   */
  async function viewer(scope: TenantScope, projectId: string) {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return { isInternal: scope.ctx.principalType === 'member', companyId: perms.companyId };
  }

  const payeeOnly = (v: { isInternal: boolean; companyId: string | null }) =>
    v.isInternal ? undefined : v.companyId ? eq(contracts.payeeCompanyId, v.companyId) : sql`false`;

  async function sovFor(scope: TenantScope, contractId: string): Promise<SovRow[]> {
    return scope.tx
      .select()
      .from(sovItems)
      .where(eq(sovItems.contractId, contractId))
      .orderBy(asc(sovItems.sort));
  }

  async function getContractRow(
    scope: TenantScope,
    projectId: string,
    contractId: string,
    seeAll = true,
  ) {
    const v = await viewer(scope, projectId);
    const [row] = await scope.tx
      .select()
      .from(contracts)
      .where(
        and(
          eq(contracts.id, contractId),
          eq(contracts.projectId, projectId),
          seeAll ? undefined : payeeOnly(v),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('financials.contract.not_found');
    return row;
  }

  async function createContract(scope: TenantScope, projectId: string, input: CreateContractInput) {
    await need(scope, 'financials.contracts.manage', projectId);
    const project = await deps.platform.getProject(scope, projectId);
    const sopaState = input.sopaState ?? project.state;
    if (!sopaState)
      throw new AppError('validation_failed', 'Set the SOPA state for this contract.', [
        { path: 'sopaState', message: 'Required when the project has no state' },
      ]);
    const codes = new Set<string>();
    let total = 0;
    for (const [i, item] of input.sov.entries()) {
      if (codes.has(item.code))
        throw new AppError('validation_failed', 'Item codes must be unique.', [
          { path: `sov/${i}/code`, message: 'Duplicate code' },
        ]);
      codes.add(item.code);
      total += toCents(item.value);
    }
    if (input.sov.length > 0 && total !== toCents(input.originalValue))
      throw new AppError(
        'validation_failed',
        `The schedule of values adds to ${fromCents(total)}, not the contract value ${input.originalValue}.`,
        [{ path: 'sov', message: 'Must add up to the contract value' }],
      );
    const id = uuidv7();
    const number = await nextNumber(scope, projectId, 'contract');
    const [row] = await scope.tx
      .insert(contracts)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number,
        kind: input.kind,
        title: input.title.trim(),
        payerCompanyId: input.payerCompanyId ?? null,
        payeeCompanyId: input.payeeCompanyId ?? null,
        originalValue: input.originalValue,
        retentionPct: input.retentionPct ?? '0',
        retentionCapPct: input.retentionCapPct ?? null,
        sopaState,
        scheduleDays: input.scheduleDays ?? null,
        paymentDays: input.paymentDays ?? null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    if (input.sov.length > 0)
      await scope.tx.insert(sovItems).values(
        input.sov.map((s, sort) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          contractId: id,
          code: s.code,
          description: s.description,
          value: s.value,
          sort,
        })),
      );
    return { contract: row!, sov: await sovFor(scope, id) };
  }

  async function listContracts(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.contracts.read', projectId);
    const v = await viewer(scope, projectId);
    return scope.tx
      .select()
      .from(contracts)
      .where(and(eq(contracts.projectId, projectId), payeeOnly(v)))
      .orderBy(desc(contracts.number));
  }

  async function getContract(scope: TenantScope, projectId: string, contractId: string) {
    await need(scope, 'financials.contracts.read', projectId);
    const contract = await getContractRow(scope, projectId, contractId, false);
    return { contract, sov: await sovFor(scope, contractId) };
  }

  /** Record a payment claim received from the payee (or made by the builder) and store its SOPA dates. */
  async function submitClaim(
    scope: TenantScope,
    projectId: string,
    contractId: string,
    input: SubmitClaimInput,
  ) {
    await need(scope, 'financials.claims.record', projectId);
    if (!(await viewer(scope, projectId)).isInternal)
      throw new AppError('access.denied', "Only the builder's staff can record a claim.");
    const contract = await getContractRow(scope, projectId, contractId);
    if (
      contract.sopaState !== 'NSW' &&
      contract.sopaState !== 'VIC' &&
      contract.sopaState !== 'QLD'
    )
      throw new AppError(
        'financials.sopa.state_not_live',
        `SOPA dates for ${contract.sopaState} are not available yet.`,
      );
    const project = await deps.platform.getProject(scope, projectId);
    const items = await sovFor(scope, contractId);
    const byId = new Map(items.map((i) => [i.id, i]));
    // What earlier claims on this contract took against each item (withdrawn claims do not count).
    const earlier = await scope.tx
      .select({
        sovItemId: paymentClaimLines.sovItemId,
        taken: sql<string>`sum(${paymentClaimLines.thisClaim})`,
        retention: sql<string>`0`,
      })
      .from(paymentClaimLines)
      .innerJoin(paymentClaims, eq(paymentClaims.id, paymentClaimLines.claimId))
      .where(and(eq(paymentClaims.contractId, contractId), ne(paymentClaims.status, 'withdrawn')))
      .groupBy(paymentClaimLines.sovItemId);
    const previousBy = new Map(earlier.map((e) => [e.sovItemId, toCents(e.taken)]));
    const [held] = await scope.tx
      .select({ held: sql<string>`coalesce(sum(${paymentClaims.retention}), 0)` })
      .from(paymentClaims)
      .where(and(eq(paymentClaims.contractId, contractId), ne(paymentClaims.status, 'withdrawn')));
    const lines = input.lines.map((l, i) => {
      const item = byId.get(l.sovItemId);
      if (!item)
        throw new AppError('validation_failed', 'That item is not on this contract.', [
          { path: `lines/${i}/sovItemId`, message: 'Not on this contract' },
        ]);
      return {
        sovItemId: item.id,
        itemValue: toCents(item.value),
        previous: previousBy.get(item.id) ?? 0,
        thisClaim: toCents(l.thisClaim),
      };
    });
    const capCents =
      contract.retentionCapPct === null
        ? null
        : Math.round(
            (toCents(contract.originalValue) * Math.round(Number(contract.retentionCapPct) * 100)) /
              10_000,
          );
    const totals = claimTotals({
      lines,
      retentionPct: Math.round(Number(contract.retentionPct) * 100),
      retentionCap: capCents,
      retentionHeld: toCents(held?.held ?? '0'),
    });
    if (isClaimError(totals))
      throw new AppError(totals.code, describeClaimError(totals), undefined, totals as never);

    const servedLocal = localDateOf(input.receivedAt, project.timezone);
    const rule = ruleInForce(SOPA_RULES, contract.sopaState as SopaState, servedLocal);
    if (!rule)
      throw new AppError(
        'financials.sopa.state_not_live',
        `No SOPA rules are in force for ${contract.sopaState} on ${servedLocal}.`,
      );
    const dates = computeDeadlines({
      rule,
      servedAt: input.receivedAt,
      timeZone: project.timezone,
      contractKind: contract.kind,
      contractScheduleDays: contract.scheduleDays,
      contractPaymentDays: contract.paymentDays,
      holidays: PUBLIC_HOLIDAYS[rule.state],
      statesAct: input.statesAct,
    });
    const id = uuidv7();
    const number = await nextNumberForContract(scope, contractId);
    const [row] = await scope.tx
      .insert(paymentClaims)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        contractId,
        number,
        periodEnd: input.periodEnd,
        receivedAt: input.receivedAt,
        statesAct: input.statesAct,
        isValid: dates.valid,
        invalidReason: dates.valid ? null : dates.reason,
        claimedGross: fromCents(totals.gross),
        lessPrevious: fromCents(totals.lessPrevious),
        retention: fromCents(totals.retention),
        claimedNet: fromCents(totals.net),
        gst: fromCents(totals.gst),
        claimedTotal: fromCents(totals.total),
        servedOn: dates.valid ? dates.servedOn : null,
        scheduleDueOn: dates.valid ? dates.scheduleDueOn : null,
        paymentDueOn: dates.valid ? dates.paymentDueOn : null,
        paymentReadDown: dates.valid ? dates.paymentReadDown : false,
        ruleState: rule.state,
        rulesReviewed: dates.rulesReviewed,
        createdBy: scope.ctx.userId,
      })
      .returning();
    await scope.tx.insert(paymentClaimLines).values(
      totals.lines.map((l) => ({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        claimId: id,
        sovItemId: l.sovItemId,
        previous: fromCents(l.previous),
        thisClaim: fromCents(l.thisClaim),
        toDate: fromCents(l.toDate),
      })),
    );
    scope.events.add({
      type: 'financials.claim.submitted.v1',
      projectId,
      entityType: 'paymentClaim',
      entityId: id,
      entityVersion: 1,
      data: { claimId: id, contractId, number, scheduleDueOn: row!.scheduleDueOn },
    });
    return claimDetail(scope, projectId, id, false);
  }

  async function nextNumberForContract(scope: TenantScope, contractId: string) {
    const [r] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${paymentClaims.number}), 0) + 1` })
      .from(paymentClaims)
      .where(eq(paymentClaims.contractId, contractId));
    return Number(r!.n);
  }

  /** Claims by payment schedule due date, soonest first, so nothing goes past its deadline (CLM-US6). */
  async function listClaims(scope: TenantScope, projectId: string, opts: { status?: string }) {
    await need(scope, 'financials.claims.read', projectId);
    const localToday = localDateOf(
      now(),
      (await deps.platform.getProject(scope, projectId)).timezone,
    );
    const v = await viewer(scope, projectId);
    const rows = await scope.tx
      .select({ claim: paymentClaims })
      .from(paymentClaims)
      .innerJoin(contracts, eq(contracts.id, paymentClaims.contractId))
      .where(
        and(
          eq(paymentClaims.projectId, projectId),
          opts.status ? eq(paymentClaims.status, opts.status) : undefined,
          payeeOnly(v),
        ),
      )
      .orderBy(sql`${paymentClaims.scheduleDueOn} asc nulls last`, asc(paymentClaims.number));
    return { rows: rows.map((r) => r.claim), today: localToday };
  }

  async function claimDetail(scope: TenantScope, projectId: string, claimId: string, check = true) {
    if (check) await need(scope, 'financials.claims.read', projectId);
    const [claim] = await scope.tx
      .select()
      .from(paymentClaims)
      .where(and(eq(paymentClaims.id, claimId), eq(paymentClaims.projectId, projectId)))
      .limit(1);
    if (!claim) throw new AppError('financials.claim.not_found');
    if (check)
      await getContractRow(scope, projectId, claim.contractId, false).catch(() => {
        throw new AppError('financials.claim.not_found');
      });
    const lines = await scope.tx
      .select()
      .from(paymentClaimLines)
      .where(eq(paymentClaimLines.claimId, claimId));
    const [schedule] = await scope.tx
      .select()
      .from(paymentSchedules)
      .where(eq(paymentSchedules.claimId, claimId))
      .limit(1);
    const today = localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);
    return { claim, lines, schedule: schedule ?? null, today };
  }

  /**
   * Issue the payment schedule. A reason is required for every reduction (CLM-AC8), the result is immutable, and
   * whether it was issued within time is recorded at issue (CLM-AC10).
   */
  async function issueSchedule(
    scope: TenantScope,
    projectId: string,
    claimId: string,
    input: IssueScheduleInput,
  ) {
    await need(scope, 'financials.claims.assess', projectId);
    const { claim, schedule } = await claimDetail(scope, projectId, claimId, false);
    if (!claim.isValid || claim.scheduleDueOn === null)
      throw new AppError(
        'conflict',
        'This is not a valid payment claim, so there is no schedule to give.',
      );
    if (schedule) throw new AppError('financials.claim.already_scheduled');
    const claimed = GST_TOTAL(claim);
    const net = toCents(claim.claimedNet);
    const scheduled = toCents(input.scheduledAmount);
    if (scheduled > net)
      throw new AppError(
        'financials.schedule.over_claim',
        'A payment schedule cannot be for more than the claim.',
        [{ path: 'scheduledAmount', message: `At most ${claim.claimedNet}` }],
      );
    const reasoned =
      (input.overallReason ?? '').trim().length > 0 || (input.lineReasons ?? []).length > 0;
    if (scheduled < net && !reasoned)
      throw new AppError(
        'financials.schedule.reason_required',
        'Give a reason for every reduction before issuing a schedule for less than the claim.',
        [{ path: 'overallReason', message: 'Required when scheduling less than claimed' }],
      );
    const issuedAt = now();
    const issuedOn = localDateOf(
      issuedAt,
      (await deps.platform.getProject(scope, projectId)).timezone,
    );
    const [row] = await scope.tx
      .insert(paymentSchedules)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        claimId,
        scheduledAmount: fromCents(scheduled),
        withheldAmount: fromCents(net - scheduled),
        overallReason: input.overallReason?.trim() || null,
        lineReasons: input.lineReasons ?? [],
        issuedAt,
        issuedBy: scope.ctx.userId,
        issuedWithinTime: issuedOn <= claim.scheduleDueOn,
      })
      .returning();
    await scope.tx
      .update(paymentClaims)
      .set({ status: 'scheduled', version: claim.version + 1 })
      .where(eq(paymentClaims.id, claimId));
    scope.events.add({
      type: 'financials.payment_schedule.issued.v1',
      projectId,
      entityType: 'paymentClaim',
      entityId: claimId,
      entityVersion: claim.version + 1,
      data: {
        claimId,
        scheduleId: row!.id,
        issuedWithinTime: row!.issuedWithinTime,
        claimed: claimed,
      },
    });
    return claimDetail(scope, projectId, claimId, false);
  }

  return {
    createContract,
    listContracts,
    getContract,
    submitClaim,
    listClaims,
    claimDetail,
    issueSchedule,
  };
}

export type FinancialsService = ReturnType<typeof createFinancialsService>;
