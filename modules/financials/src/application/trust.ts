import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { localDateOf } from '@archova/time';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { fromCents, percentOf, toCents } from '../domain/money';
import { trustPosition, trustRequirement, trustTotals, type MovementInput } from '../domain/trust';
import type { contracts } from '../infra/tables';
import {
  paymentClaims,
  paymentSchedules,
  payments,
  trustAccounts,
  trustMovements,
} from '../infra/tables';

type ContractRow = typeof contracts.$inferSelect;
export type TrustAccountRow = typeof trustAccounts.$inferSelect;
export type TrustMovementRow = typeof trustMovements.$inferSelect;

export interface TrustDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject'>;
  now?: () => Date;
  /** Contract lookup that already hides contracts a subcontractor is not the payee of. */
  contractFor: (
    scope: TenantScope,
    projectId: string,
    contractId: string,
    seeAll: boolean,
  ) => Promise<ContractRow>;
  requireStaff: (scope: TenantScope, projectId: string, what: string) => Promise<void>;
}

export interface SaveTrustProfileInput {
  governmentClient?: boolean;
  institution?: string | null;
  accountName?: string | null;
  accountLast4?: string | null;
  openedOn?: string | null;
}

export interface RecordMovementInput {
  kind: 'deposit' | 'interest' | 'release' | 'reversal';
  /** Positive. The sign follows the kind. */
  amount: string;
  movedOn: string;
  reference: string;
  note?: string;
  reversesMovementId?: string;
}

const signed = (m: Pick<TrustMovementRow, 'amount'>) =>
  m.amount.startsWith('-') ? -toCents(m.amount.slice(1)) : toCents(m.amount);
const fromSigned = (cents: number) => fromCents(cents);

export function createTrustService(deps: TrustDeps) {
  const now = deps.now ?? (() => new Date());

  async function account(scope: TenantScope, contractId: string) {
    const [row] = await scope.tx
      .select()
      .from(trustAccounts)
      .where(eq(trustAccounts.contractId, contractId))
      .limit(1);
    return row ?? null;
  }

  async function movementsOf(scope: TenantScope, accountId: string) {
    return scope.tx
      .select()
      .from(trustMovements)
      .where(eq(trustMovements.trustAccountId, accountId))
      .orderBy(asc(trustMovements.movedOn), asc(trustMovements.recordedAt), asc(trustMovements.id));
  }

  async function retentionWithheld(scope: TenantScope, contractId: string) {
    const [r] = await scope.tx
      .select({ total: sql<string>`coalesce(sum(${paymentClaims.retention}), 0)` })
      .from(paymentClaims)
      .where(and(eq(paymentClaims.contractId, contractId), eq(paymentClaims.isValid, true)));
    return toCents(r?.total ?? '0');
  }

  async function summary(scope: TenantScope, contract: ContractRow) {
    const acct = await account(scope, contract.id);
    const rows = acct ? await movementsOf(scope, acct.id) : [];
    const inputs: MovementInput[] = rows.map((m) => ({
      id: m.id,
      kind: m.kind,
      amountCents: signed(m),
      reversesMovementId: m.reversesMovementId,
    }));
    const requirement = trustRequirement({
      sopaState: contract.sopaState,
      valueCents: toCents(contract.originalValue),
      governmentClient: acct?.governmentClient ?? false,
    });
    const withheld = await retentionWithheld(scope, contract.id);
    const position = trustPosition({
      required: requirement.required,
      setUp: acct?.institution !== null && acct?.institution !== undefined,
      retentionWithheldCents: withheld,
      totals: trustTotals(inputs),
    });
    return { contract, account: acct, requirement, withheld, position, movements: rows };
  }

  async function getTrust(scope: TenantScope, projectId: string, contractId: string) {
    await deps.access.assert(scope, 'financials.contracts.read', { projectId });
    return summary(scope, await deps.contractFor(scope, projectId, contractId, false));
  }

  async function saveProfile(
    scope: TenantScope,
    projectId: string,
    contractId: string,
    input: SaveTrustProfileInput,
  ) {
    await deps.access.assert(scope, 'financials.trust.manage', { projectId });
    await deps.requireStaff(scope, projectId, 'record trust account details');
    const contract = await deps.contractFor(scope, projectId, contractId, true);
    const values = {
      ...(input.governmentClient !== undefined ? { governmentClient: input.governmentClient } : {}),
      ...(input.institution !== undefined ? { institution: input.institution } : {}),
      ...(input.accountName !== undefined ? { accountName: input.accountName } : {}),
      ...(input.accountLast4 !== undefined ? { accountLast4: input.accountLast4 } : {}),
      ...(input.openedOn !== undefined ? { openedOn: input.openedOn } : {}),
      updatedAt: now(),
      updatedBy: scope.ctx.userId,
    };
    await scope.tx
      .insert(trustAccounts)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        contractId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [trustAccounts.orgId, trustAccounts.contractId],
        set: values,
      });
    scope.events.add({
      type: 'financials.trust.profile_saved.v1',
      projectId,
      entityType: 'contract',
      entityId: contractId,
      entityVersion: 1,
      data: { contractId },
    });
    return summary(scope, contract);
  }

  /** Writes one movement after the caller has checked permission. Serialised per trust account. */
  async function insertMovement(
    scope: TenantScope,
    projectId: string,
    contractId: string,
    acct: TrustAccountRow,
    input: RecordMovementInput,
  ) {
    // Two people recording at once must see each other's rows before the balance check below.
    await scope.tx
      .select({ id: trustAccounts.id })
      .from(trustAccounts)
      .where(eq(trustAccounts.id, acct.id))
      .for('update');
    const existing = await movementsOf(scope, acct.id);
    const totals = trustTotals(
      existing.map((m) => ({
        id: m.id,
        kind: m.kind,
        amountCents: signed(m),
        reversesMovementId: m.reversesMovementId,
      })),
    );
    const cents = toCents(input.amount);
    if (cents === 0) throw new AppError('validation_failed', 'Amount must be more than zero');

    let signedCents: number;
    let reverses: string | null = null;
    if (input.kind === 'reversal') {
      const original = existing.find((m) => m.id === input.reversesMovementId);
      if (!original || original.kind === 'reversal')
        throw new AppError('financials.trust.movement_not_found');
      if (existing.some((m) => m.reversesMovementId === original.id))
        throw new AppError('financials.trust.already_reversed');
      reverses = original.id;
      signedCents = -signed(original);
    } else {
      signedCents = input.kind === 'release' ? -cents : cents;
    }
    // A trust account cannot be paid out below zero.
    if (totals.balanceCents + signedCents < 0) throw new AppError('financials.trust.insufficient');

    const id = uuidv7();
    await scope.tx.insert(trustMovements).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      trustAccountId: acct.id,
      kind: input.kind,
      amount: fromSigned(signedCents),
      movedOn: input.movedOn,
      reference: input.reference,
      note: input.note ?? null,
      reversesMovementId: reverses,
      recordedBy: scope.ctx.userId,
    });
    scope.events.add({
      type: 'financials.trust.movement_recorded.v1',
      projectId,
      entityType: 'trust_movement',
      entityId: id,
      entityVersion: 1,
      data: { contractId, kind: input.kind, amount: fromSigned(signedCents) },
    });
  }

  async function recordMovement(
    scope: TenantScope,
    projectId: string,
    contractId: string,
    input: RecordMovementInput,
  ) {
    await deps.access.assert(scope, 'financials.trust.manage', { projectId });
    await deps.requireStaff(scope, projectId, 'record trust account movements');
    const contract = await deps.contractFor(scope, projectId, contractId, true);
    const acct = await account(scope, contractId);
    if (!acct) throw new AppError('financials.trust.not_set_up');
    await insertMovement(scope, projectId, contractId, acct, input);
    return summary(scope, contract);
  }

  /**
   * Takes retention that has been released out of the trust account too. Internal: the retention service has already
   * checked permission. Returns `skipped` when no trust account has been recorded for the contract, so contracts with
   * no trust keep working; throws `financials.trust.insufficient` when the account holds less than is being released.
   */
  async function releaseFromTrust(
    scope: TenantScope,
    projectId: string,
    contractId: string,
    input: { amount: string; movedOn: string; reference: string; note?: string },
  ): Promise<'moved' | 'skipped'> {
    const acct = await account(scope, contractId);
    if (!acct || acct.institution === null) return 'skipped';
    await insertMovement(scope, projectId, contractId, acct, { kind: 'release', ...input });
    return 'moved';
  }

  /**
   * What a subcontractor sees on their own contract: each claim, the schedule against it, what has been paid and
   * what is still owing, plus the retention held for them and where it sits (CLM-AC11). The contract lookup hides
   * any contract they are not the payee of.
   */
  async function paymentSummary(scope: TenantScope, projectId: string, contractId: string) {
    await deps.access.assert(scope, 'financials.claims.read', { projectId });
    const contract = await deps.contractFor(scope, projectId, contractId, false);
    const today = localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);
    const claims = await scope.tx
      .select()
      .from(paymentClaims)
      .where(and(eq(paymentClaims.contractId, contractId), eq(paymentClaims.isValid, true)))
      .orderBy(asc(paymentClaims.number));
    const claimIds = claims.map((c) => c.id);
    const schedules = claimIds.length
      ? await scope.tx
          .select()
          .from(paymentSchedules)
          .where(inArray(paymentSchedules.claimId, claimIds))
      : [];
    const paid = claimIds.length
      ? await scope.tx
          .select({
            claimId: payments.claimId,
            total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
            last: sql<string | null>`max(${payments.paidOn})`,
          })
          .from(payments)
          .where(inArray(payments.claimId, claimIds))
          .groupBy(payments.claimId)
      : [];
    const schedByClaim = new Map(schedules.map((s) => [s.claimId, s]));
    const paidByClaim = new Map(paid.map((p) => [p.claimId, p]));

    let dueTotal = 0;
    let paidTotal = 0;
    const rows = claims.map((c) => {
      const s = schedByClaim.get(c.id);
      const p = paidByClaim.get(c.id);
      // The schedule amount is ex GST and after retention; GST is 10% of it (ledger lines use the same rule).
      const due = s
        ? toCents(s.scheduledAmount) + percentOf(toCents(s.scheduledAmount), 1000)
        : null;
      const paidCents = p ? signed({ amount: p.total }) : 0;
      const outstanding = due === null ? null : Math.max(0, due - paidCents);
      if (due !== null) dueTotal += due;
      paidTotal += paidCents;
      return {
        claim: c,
        scheduledAmount: s?.scheduledAmount ?? null,
        amountDue: due === null ? null : fromCents(due),
        paid: fromCents(paidCents),
        lastPaidOn: p?.last ?? null,
        outstanding: outstanding === null ? null : fromCents(outstanding),
        overdue:
          outstanding !== null && outstanding > 0 && !!c.paymentDueOn && c.paymentDueOn < today,
      };
    });
    const trust = await summary(scope, contract);
    return { contract, rows, dueTotal, paidTotal, trust };
  }

  return { getTrust, saveProfile, recordMovement, releaseFromTrust, paymentSummary };
}

export type TrustService = ReturnType<typeof createTrustService>;
