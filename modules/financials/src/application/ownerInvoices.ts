import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { toCents } from '../domain/money';
import {
  backupItemsFor,
  checkSubClaims,
  ownerInvoiceTotals,
  type BackupItem,
  type OwnerInvoiceFlag,
  type SubClaimFacts,
} from '../domain/owner-invoice';
import {
  claimStatements,
  contracts,
  evidenceRecords,
  ownerInvoices,
  ownerInvoiceSources,
  paymentClaims,
  paymentSchedules,
  variations,
} from '../infra/tables';

export type OwnerInvoiceRow = typeof ownerInvoices.$inferSelect;

export interface OwnerInvoicesDeps {
  access: AccessService;
  requireStaff: (scope: TenantScope, projectId: string, what: string) => Promise<void>;
  now?: () => Date;
}

export interface SubClaimCandidate {
  facts: SubClaimFacts;
  contractTitle: string;
  status: string;
  /** What gets passed up: the scheduled amount when a schedule was issued, else the net claimed. */
  amount: string;
  withheld: string;
  flags: OwnerInvoiceFlag[];
  backup: BackupItem[];
}

export interface CreateOwnerInvoiceInput {
  periodEnd: string;
  markupPct: string;
  note?: string;
  claimIds: string[];
  /** Claims whose flags the person has looked at and accepts. Every flagged claim needs to be here. */
  confirmedClaimIds: string[];
}

/** NSW asks for a subcontractor's statement with each payment claim a subcontractor makes (as on the claim detail). */
const statementExpected = (c: { kind: string; sopaState: string }) =>
  c.kind === 'subcontract' && c.sopaState === 'NSW';

/**
 * Owner invoice pre-fill: the approved subcontractor claims on a project, compiled into a draft against the head
 * contract with a backup pack, after Nova's duplicate and outlier check. Builder staff only. Reads the same claims
 * the commitment Invoices tab does and copies nothing but the amounts taken.
 */
export function createOwnerInvoicesService(deps: OwnerInvoicesDeps) {
  const need = async (scope: TenantScope, key: string, projectId: string) => {
    await deps.access.assert(scope, key, { projectId });
    await deps.requireStaff(scope, projectId, 'work with owner invoices');
  };

  async function headContract(scope: TenantScope, projectId: string, contractId: string) {
    const [k] = await scope.tx
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, contractId), eq(contracts.projectId, projectId)))
      .limit(1);
    if (!k) throw new AppError('financials.contract.not_found');
    if (k.kind !== 'head')
      throw new AppError(
        'financials.owner_invoice.not_head_contract',
        'Owner invoices are made on the head contract.',
      );
    return k;
  }

  /** Every live (not withdrawn) claim on the project's subcontracts, with what the check and the backup need. */
  async function subClaims(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select({ claim: paymentClaims, contract: contracts })
      .from(paymentClaims)
      .innerJoin(contracts, eq(contracts.id, paymentClaims.contractId))
      .where(
        and(
          eq(paymentClaims.projectId, projectId),
          eq(contracts.kind, 'subcontract'),
          ne(paymentClaims.status, 'withdrawn'),
        ),
      );
    const claimIds = rows.map((r) => r.claim.id);
    const contractIds = [...new Set(rows.map((r) => r.contract.id))];
    const [schedules, statements, evidence, approved] = await Promise.all([
      claimIds.length
        ? scope.tx
            .select()
            .from(paymentSchedules)
            .where(inArray(paymentSchedules.claimId, claimIds))
        : [],
      claimIds.length
        ? scope.tx.select().from(claimStatements).where(inArray(claimStatements.claimId, claimIds))
        : [],
      claimIds.length
        ? scope.tx
            .select({ claimId: evidenceRecords.claimId, kind: evidenceRecords.kind })
            .from(evidenceRecords)
            .where(inArray(evidenceRecords.claimId, claimIds))
        : [],
      contractIds.length
        ? scope.tx
            .select({ contractId: variations.contractId, amount: variations.amount })
            .from(variations)
            .where(
              and(inArray(variations.contractId, contractIds), eq(variations.status, 'approved')),
            )
        : [],
    ]);
    const sched = new Map(schedules.map((s) => [s.claimId, s]));
    const stmt = new Map(statements.map((s) => [s.claimId, s]));
    const ev = new Set(evidence.map((e) => `${e.claimId}:${e.kind}`));
    const varSum = new Map<string, number>();
    for (const v of approved)
      varSum.set(v.contractId, (varSum.get(v.contractId) ?? 0) + toCents(v.amount));
    return rows.map(({ claim, contract }) => {
      const s = sched.get(claim.id);
      const st = stmt.get(claim.id);
      const expected = statementExpected(contract);
      const facts: SubClaimFacts = {
        claimId: claim.id,
        contractId: contract.id,
        payeeCompanyId: contract.payeeCompanyId,
        number: claim.number,
        periodEnd: claim.periodEnd,
        completedToDateCents: toCents(claim.claimedGross),
        thisPeriodCents: toCents(claim.claimedGross) - toCents(claim.lessPrevious),
        revisedSumCents: toCents(contract.originalValue) + (varSum.get(contract.id) ?? 0),
        isValid: claim.isValid,
        statementExpected: expected,
        hasStatement: !!st,
      };
      return {
        facts,
        contractTitle: contract.title,
        status: claim.status,
        amount: s ? s.scheduledAmount : claim.claimedNet,
        withheld: s ? s.withheldAmount : '0.00',
        backup: backupItemsFor({
          hasClaimPdf: ev.has(`${claim.id}:claim`),
          hasSchedulePdf: ev.has(`${claim.id}:schedule`),
          statementExpected: expected,
          hasStatement: !!st,
          statementSignedOn: st?.signedOn ?? null,
        }),
      };
    });
  }

  async function billedClaims(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select({ claimId: ownerInvoiceSources.claimId, number: ownerInvoices.number })
      .from(ownerInvoiceSources)
      .innerJoin(ownerInvoices, eq(ownerInvoices.id, ownerInvoiceSources.ownerInvoiceId))
      .where(eq(ownerInvoiceSources.projectId, projectId));
    return new Map(rows.map((r) => [r.claimId, r.number]));
  }

  /**
   * The "pre-fill the Owner Invoice?" step: approved subcontractor claims (payment schedule issued or paid) up to
   * `periodEnd` that no owner invoice has taken yet, each with Nova's flags and what backs it up.
   */
  async function prefill(
    scope: TenantScope,
    projectId: string,
    contractId: string,
    periodEnd: string,
  ): Promise<{ periodEnd: string; candidates: SubClaimCandidate[] }> {
    await need(scope, 'financials.claims.read', projectId);
    await headContract(scope, projectId, contractId);
    const [all, billed] = await Promise.all([
      subClaims(scope, projectId),
      billedClaims(scope, projectId),
    ]);
    const open = all.filter(
      (c) =>
        (c.status === 'scheduled' || c.status === 'paid') &&
        !billed.has(c.facts.claimId) &&
        c.facts.periodEnd <= periodEnd,
    );
    const flags = checkSubClaims(
      open.map((c) => c.facts),
      all.map((c) => c.facts),
    );
    const candidates = open
      .map((c) => ({ ...c, flags: flags.get(c.facts.claimId) ?? [] }))
      .sort(
        (a, b) =>
          a.facts.periodEnd.localeCompare(b.facts.periodEnd) ||
          a.contractTitle.localeCompare(b.contractTitle) ||
          a.facts.number - b.facts.number,
      );
    return { periodEnd, candidates };
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    contractId: string,
    input: CreateOwnerInvoiceInput,
  ) {
    await need(scope, 'financials.claims.record', projectId);
    await headContract(scope, projectId, contractId);
    // Serialise drafts on this contract so two people can't take the same claim or the same number.
    await scope.tx
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.id, contractId))
      .for('update');
    const wanted = [...new Set(input.claimIds)];
    const { candidates } = await prefill(scope, projectId, contractId, input.periodEnd);
    const byId = new Map(candidates.map((c) => [c.facts.claimId, c]));
    const taken = await billedClaims(scope, projectId);
    for (const id of wanted) {
      if (taken.has(id))
        throw new AppError(
          'financials.owner_invoice.claim_taken',
          `Claim already passed up on owner invoice ${taken.get(id)}.`,
        );
      if (!byId.has(id))
        throw new AppError(
          'financials.owner_invoice.claim_not_eligible',
          'Only approved subcontractor claims up to the period end can be included.',
        );
    }
    const confirmed = new Set(input.confirmedClaimIds);
    const unconfirmed = wanted.filter((id) => byId.get(id)!.flags.length > 0 && !confirmed.has(id));
    if (unconfirmed.length)
      throw new AppError(
        'financials.owner_invoice.flags_unconfirmed',
        'Confirm the flagged claims before including them.',
        undefined,
        { claimIds: unconfirmed },
      );
    const chosen = wanted.map((id) => byId.get(id)!);
    const totals = ownerInvoiceTotals(
      chosen.map((c) => c.amount),
      input.markupPct,
    );
    const [last] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${ownerInvoices.number}), 0)` })
      .from(ownerInvoices)
      .where(eq(ownerInvoices.contractId, contractId));
    const id = uuidv7();
    const at = (deps.now ?? (() => new Date()))();
    const [created] = await scope.tx
      .insert(ownerInvoices)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        contractId,
        number: Number(last?.n ?? 0) + 1,
        periodEnd: input.periodEnd,
        markupPct: input.markupPct,
        ...totals,
        note: input.note ?? null,
        createdBy: scope.ctx.userId,
      })
      .returning();
    await scope.tx.insert(ownerInvoiceSources).values(
      chosen.map((c) => ({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        ownerInvoiceId: id,
        claimId: c.facts.claimId,
        amount: c.amount,
        flags: c.flags,
        flagsConfirmedBy: c.flags.length ? scope.ctx.userId : null,
        flagsConfirmedAt: c.flags.length ? at : null,
      })),
    );
    return detail(scope, projectId, created!.id, false);
  }

  async function list(scope: TenantScope, projectId: string, contractId: string) {
    await need(scope, 'financials.claims.read', projectId);
    await headContract(scope, projectId, contractId);
    const rows = await scope.tx
      .select()
      .from(ownerInvoices)
      .where(eq(ownerInvoices.contractId, contractId))
      .orderBy(desc(ownerInvoices.number));
    return rows;
  }

  /** One draft with the claims in it, their flags and the backup pack (what is attached and what is missing). */
  async function detail(scope: TenantScope, projectId: string, id: string, check = true) {
    if (check) await need(scope, 'financials.claims.read', projectId);
    const [invoice] = await scope.tx
      .select()
      .from(ownerInvoices)
      .where(and(eq(ownerInvoices.id, id), eq(ownerInvoices.projectId, projectId)))
      .limit(1);
    if (!invoice) throw new AppError('financials.owner_invoice.not_found');
    const sources = await scope.tx
      .select()
      .from(ownerInvoiceSources)
      .where(eq(ownerInvoiceSources.ownerInvoiceId, id))
      .orderBy(asc(ownerInvoiceSources.id));
    const all = await subClaims(scope, projectId);
    const byClaim = new Map(all.map((c) => [c.facts.claimId, c]));
    const lines = sources.map((s) => {
      const c = byClaim.get(s.claimId);
      return { source: s, claim: c ?? null };
    });
    return { invoice, lines };
  }

  /** A draft is not evidence: discarding it frees its claims to go on another invoice. */
  async function discard(scope: TenantScope, projectId: string, id: string) {
    await need(scope, 'financials.claims.record', projectId);
    const [invoice] = await scope.tx
      .select({ id: ownerInvoices.id })
      .from(ownerInvoices)
      .where(and(eq(ownerInvoices.id, id), eq(ownerInvoices.projectId, projectId)))
      .limit(1);
    if (!invoice) throw new AppError('financials.owner_invoice.not_found');
    await scope.tx.delete(ownerInvoices).where(eq(ownerInvoices.id, id));
  }

  return { prefill, create, list, detail, discard };
}

export type OwnerInvoicesService = ReturnType<typeof createOwnerInvoicesService>;
