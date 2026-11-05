import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  SOPA_RULES,
  computeDeadlines,
  ruleInForce,
  uuidv7,
  type ContractKind,
  type SopaState,
} from '@archova/domain';
import { localDateOf } from '@archova/time';
import {
  AppError,
  nextNumber,
  recordRetention,
  recordRetentionBatch,
  type TenantScope,
} from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { ledgerLines } from '../domain/ledger';
import { claimTotals, describeClaimError, isClaimError } from '../domain/claim';
import { PUBLIC_HOLIDAYS } from '../domain/holidays';
import { fromCents, toCents } from '../domain/money';
import {
  canonicalJson,
  renderEvidencePdf,
  sha256Hex,
  type EvidenceKind,
  type EvidenceSnapshot,
} from '../domain/evidence';
import {
  contracts,
  costCodes,
  evidenceRecords,
  paymentClaimLines,
  paymentClaims,
  paymentSchedules,
  payments,
  sovItems,
  variations,
} from '../infra/tables';

export type ContractRow = typeof contracts.$inferSelect;
export type SovRow = typeof sovItems.$inferSelect;
export type ClaimRow = typeof paymentClaims.$inferSelect;
export type ClaimLineRow = typeof paymentClaimLines.$inferSelect;
export type ScheduleRow = typeof paymentSchedules.$inferSelect;
export type VariationRow = typeof variations.$inferSelect;
export type EvidenceRow = typeof evidenceRecords.$inferSelect;

export interface FinancialsDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject' | 'companyIdentity'>;
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
  sov: { code: string; description: string; value: string; costCodeId?: string }[];
}

/** What an accounting system needs to record a claim, in cents and neutral of any provider (integrations/02 §2). */
export interface LedgerSource {
  kind: 'bill' | 'invoice';
  localType: 'payment_schedule' | 'claim';
  localId: string;
  contractNumber: number;
  claimNumber: number;
  /** The subcontractor for a bill, the client for an invoice. */
  counterparty: { companyId: string; name: string; abn: string | null } | null;
  date: string;
  dueDate: string;
  lines: { code: string; description: string; amountCents: number; gstCents: number }[];
  retentionCents: number;
}

/** A payment reported by a connector (Xero or MYOB), in cents, against the record it was pushed from. */
export interface PaymentInput {
  localType: 'payment_schedule' | 'claim';
  localId: string;
  paidOn: string;
  /** Negative for a reversal. */
  amountCents: number;
  source: 'xero' | 'myob';
  externalRef: string;
  reference: string;
  /** Set on a reversal: the `externalRef` of the payment it undoes. */
  reversesExternalRef?: string;
}

export interface SubmitClaimInput {
  periodEnd: string;
  receivedAt: Date;
  statesAct: boolean;
  lines: { sovItemId?: string; variationId?: string; thisClaim: string }[];
}

export interface CreateVariationInput {
  title: string;
  description?: string;
  amount: string;
  timeImpactDays?: number;
}

export interface IssueScheduleInput {
  scheduledAmount: string;
  overallReason?: string;
  lineReasons?: { sovItemId: string; reason: string }[];
}

const OUTSIDER_VISIBLE = ['submitted', 'approved', 'rejected'];

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

  /** Serialise writes that read running totals for one contract, so two concurrent claims can't both pass a cap. */
  async function lockContract(scope: TenantScope, contractId: string) {
    await scope.tx
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.id, contractId))
      .for('update');
  }

  /** Setting up contracts and assessing claims is builder-side work whatever custom template a user holds. */
  async function requireStaff(scope: TenantScope, projectId: string, what: string) {
    if (!(await viewer(scope, projectId)).isInternal)
      throw new AppError('access.denied', `Only the builder's staff can ${what}.`);
  }

  async function createContract(scope: TenantScope, projectId: string, input: CreateContractInput) {
    await need(scope, 'financials.contracts.manage', projectId);
    await requireStaff(scope, projectId, 'set up a contract');
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
    const tagged = [...new Set(input.sov.flatMap((s) => (s.costCodeId ? [s.costCodeId] : [])))];
    if (tagged.length > 0) {
      const found = await scope.tx
        .select({ id: costCodes.id })
        .from(costCodes)
        .where(and(eq(costCodes.projectId, projectId), inArray(costCodes.id, tagged)));
      if (found.length !== tagged.length)
        throw new AppError(
          'financials.cost_code.not_found',
          'A cost code on the schedule is not on this project.',
        );
    }
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
    const sovValues = input.sov.map((s, sort) => ({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      contractId: id,
      code: s.code,
      description: s.description,
      value: s.value,
      sort,
      costCodeId: s.costCodeId ?? null,
    }));
    if (sovValues.length > 0) await scope.tx.insert(sovItems).values(sovValues);
    // Project records, kept 10 years (compliance/07 §3); a legal hold overrides.
    await recordRetention(scope, {
      recordType: 'financials.contracts',
      recordId: id,
      projectId,
      category: 'project_records_10y',
      anchor: row!.createdAt,
    });
    await recordRetentionBatch(
      scope,
      'financials.sov_items',
      'project_records_10y',
      row!.createdAt,
      sovValues.map((v) => ({ recordId: v.id, projectId })),
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
    await requireStaff(scope, projectId, 'record a claim');
    const contract = await getContractRow(scope, projectId, contractId);
    await lockContract(scope, contractId);
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
    // What earlier claims on this contract took against each item or variation (withdrawn claims do not count).
    const earlier = await scope.tx
      .select({
        sovItemId: paymentClaimLines.sovItemId,
        variationId: paymentClaimLines.variationId,
        taken: sql<string>`sum(${paymentClaimLines.thisClaim})`,
      })
      .from(paymentClaimLines)
      .innerJoin(paymentClaims, eq(paymentClaims.id, paymentClaimLines.claimId))
      .where(and(eq(paymentClaims.contractId, contractId), ne(paymentClaims.status, 'withdrawn')))
      .groupBy(paymentClaimLines.sovItemId, paymentClaimLines.variationId);
    const previousBy = new Map(
      earlier.map((e) => [(e.sovItemId ?? e.variationId)!, toCents(e.taken)]),
    );
    const varRows = await scope.tx
      .select()
      .from(variations)
      .where(eq(variations.contractId, contractId));
    const varById = new Map(varRows.map((v) => [v.id, v]));
    const [held] = await scope.tx
      .select({ held: sql<string>`coalesce(sum(${paymentClaims.retention}), 0)` })
      .from(paymentClaims)
      .where(and(eq(paymentClaims.contractId, contractId), ne(paymentClaims.status, 'withdrawn')));
    const lines = input.lines.map((l, i) => {
      if (!l.sovItemId === !l.variationId)
        throw new AppError('validation_failed', 'Claim either a schedule item or a variation.', [
          { path: `lines/${i}`, message: 'Give exactly one of sovItemId or variationId' },
        ]);
      if (l.variationId) {
        const v = varById.get(l.variationId);
        if (!v)
          throw new AppError('validation_failed', 'That variation is not on this contract.', [
            { path: `lines/${i}/variationId`, message: 'Not on this contract' },
          ]);
        if (v.status !== 'approved')
          throw new AppError(
            'financials.variation.not_approved',
            `Variation ${v.number} is ${v.status}. Only an approved variation can be claimed.`,
          );
        return {
          variationId: v.id,
          itemValue: toCents(v.amount),
          previous: previousBy.get(v.id) ?? 0,
          thisClaim: toCents(l.thisClaim),
        };
      }
      const item = byId.get(l.sovItemId!);
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
    const lineValues = totals.lines.map((l) => ({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      claimId: id,
      sovItemId: l.sovItemId ?? null,
      variationId: l.variationId ?? null,
      previous: fromCents(l.previous),
      thisClaim: fromCents(l.thisClaim),
      toDate: fromCents(l.toDate),
    }));
    await scope.tx.insert(paymentClaimLines).values(lineValues);
    // Claims are SOPA evidence: 10 years (compliance/07 §3), or longer while a hold applies.
    await recordRetention(scope, {
      recordType: 'financials.payment_claims',
      recordId: id,
      projectId,
      category: 'sopa_evidence_10y',
      anchor: row!.createdAt,
    });
    await recordRetentionBatch(
      scope,
      'financials.payment_claim_lines',
      'sopa_evidence_10y',
      row!.createdAt,
      lineValues.map((v) => ({ recordId: v.id, projectId })),
    );
    scope.events.add({
      type: 'financials.claim.submitted.v1',
      projectId,
      entityType: 'paymentClaim',
      entityId: id,
      entityVersion: 1,
      data: { claimId: id, contractId, number, scheduleDueOn: row!.scheduleDueOn },
    });
    await seal(scope, projectId, id, 'claim');
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
   * Sealed evidence (compliance/01 §4): in the transaction that records a claim or issues its schedule, take a
   * snapshot of everything it rests on, hash it, and render the PDF from that snapshot. The row is immutable.
   */
  async function seal(scope: TenantScope, projectId: string, claimId: string, kind: EvidenceKind) {
    const { claim, lines, schedule } = await claimDetail(scope, projectId, claimId, false);
    const contract = await getContractRow(scope, projectId, claim.contractId, false);
    const project = await deps.platform.getProject(scope, projectId);
    const sov = new Map((await sovFor(scope, contract.id)).map((i) => [i.id, i]));
    const vars = new Map(
      (await scope.tx.select().from(variations).where(eq(variations.contractId, contract.id))).map(
        (v) => [v.id, v],
      ),
    );
    const refOf = (l: { sovItemId: string | null; variationId: string | null }) => {
      const i = l.sovItemId ? sov.get(l.sovItemId) : undefined;
      if (i) return { ref: i.code, description: i.description };
      const v = l.variationId ? vars.get(l.variationId) : undefined;
      return { ref: v ? `V${v.number}` : 'unknown', description: v?.title ?? '' };
    };
    const sealedAt = now();
    const head = {
      sealedAt: sealedAt.toISOString(),
      timeZone: project.timezone,
      contract: {
        number: contract.number,
        title: contract.title,
        kind: contract.kind,
        sopaState: contract.sopaState,
      },
    };
    let snapshot: EvidenceSnapshot;
    if (kind === 'claim') {
      snapshot = {
        kind,
        ...head,
        claim: {
          id: claim.id,
          number: claim.number,
          periodEnd: claim.periodEnd,
          receivedAt: claim.receivedAt.toISOString(),
          statesAct: claim.statesAct,
          isValid: claim.isValid,
          invalidReason: claim.invalidReason,
          claimedGross: claim.claimedGross,
          lessPrevious: claim.lessPrevious,
          retention: claim.retention,
          claimedNet: claim.claimedNet,
          gst: claim.gst,
          claimedTotal: claim.claimedTotal,
          servedOn: claim.servedOn,
          scheduleDueOn: claim.scheduleDueOn,
          paymentDueOn: claim.paymentDueOn,
          paymentReadDown: claim.paymentReadDown,
          ruleState: claim.ruleState,
          rulesReviewed: claim.rulesReviewed,
        },
        lines: lines.map((l) => ({
          ...refOf(l),
          previous: l.previous,
          thisClaim: l.thisClaim,
          toDate: l.toDate,
        })),
      };
    } else {
      if (!schedule) throw new AppError('financials.claim.not_found');
      const [claimEvidence] = await scope.tx
        .select({ sha: evidenceRecords.snapshotSha256 })
        .from(evidenceRecords)
        .where(and(eq(evidenceRecords.claimId, claimId), eq(evidenceRecords.kind, 'claim')))
        .limit(1);
      snapshot = {
        kind,
        ...head,
        claim: {
          id: claim.id,
          number: claim.number,
          claimedNet: claim.claimedNet,
          scheduleDueOn: claim.scheduleDueOn,
        },
        claimEvidenceSha256: claimEvidence?.sha ?? null,
        schedule: {
          id: schedule.id,
          scheduledAmount: schedule.scheduledAmount,
          withheldAmount: schedule.withheldAmount,
          overallReason: schedule.overallReason,
          lineReasons: schedule.lineReasons.map((r) => ({
            ref: refOf({ sovItemId: r.sovItemId, variationId: null }).ref,
            reason: r.reason,
          })),
          issuedAt: schedule.issuedAt.toISOString(),
          issuedWithinTime: schedule.issuedWithinTime,
        },
      };
    }
    const snapshotText = canonicalJson(snapshot);
    const snapshotSha256 = sha256Hex(snapshotText);
    const pdf = Buffer.from(await renderEvidencePdf(snapshot, snapshotSha256));
    await scope.tx.insert(evidenceRecords).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      claimId,
      kind,
      sealedAt,
      snapshot: JSON.parse(snapshotText),
      snapshotText,
      snapshotSha256,
      pdf,
      pdfSha256: sha256Hex(pdf),
    });
  }

  /** Evidence for a claim the viewer may see, each record re-hashed so a changed row shows as not intact. */
  async function listEvidence(scope: TenantScope, projectId: string, claimId: string) {
    await claimDetail(scope, projectId, claimId, true);
    const rows = await scope.tx
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.claimId, claimId))
      .orderBy(asc(evidenceRecords.sealedAt));
    return rows.map((r) => ({
      kind: r.kind,
      sealedAt: r.sealedAt,
      snapshotSha256: r.snapshotSha256,
      pdfSha256: r.pdfSha256,
      pdfBytes: r.pdf.length,
      intact: sha256Hex(r.snapshotText) === r.snapshotSha256 && sha256Hex(r.pdf) === r.pdfSha256,
    }));
  }

  async function evidenceFile(
    scope: TenantScope,
    projectId: string,
    claimId: string,
    kind: EvidenceKind,
  ) {
    const { claim } = await claimDetail(scope, projectId, claimId, true);
    const [r] = await scope.tx
      .select()
      .from(evidenceRecords)
      .where(and(eq(evidenceRecords.claimId, claimId), eq(evidenceRecords.kind, kind)))
      .limit(1);
    if (!r) throw new AppError('financials.evidence.not_found');
    if (sha256Hex(r.snapshotText) !== r.snapshotSha256 || sha256Hex(r.pdf) !== r.pdfSha256)
      throw new AppError('conflict', 'This evidence record no longer matches its seal.');
    return { row: r, stem: `claim-${claim.number}-${kind}-evidence` };
  }

  async function evidencePdf(
    scope: TenantScope,
    projectId: string,
    claimId: string,
    kind: EvidenceKind,
  ) {
    const { row, stem } = await evidenceFile(scope, projectId, claimId, kind);
    return {
      filename: `${stem}.pdf`,
      contentType: 'application/pdf' as const,
      dataBase64: row.pdf.toString('base64'),
    };
  }

  async function evidenceJson(
    scope: TenantScope,
    projectId: string,
    claimId: string,
    kind: EvidenceKind,
  ) {
    const { row, stem } = await evidenceFile(scope, projectId, claimId, kind);
    return {
      filename: `${stem}.json`,
      contentType: 'application/json' as const,
      snapshotSha256: row.snapshotSha256,
      dataText: row.snapshotText,
    };
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
    await requireStaff(scope, projectId, 'issue a payment schedule');
    const { claim, schedule } = await claimDetail(scope, projectId, claimId, false);
    if (!claim.isValid || claim.scheduleDueOn === null)
      throw new AppError(
        'conflict',
        'This is not a valid payment claim, so there is no schedule to give.',
      );
    if (schedule) throw new AppError('financials.claim.already_scheduled');
    if (claim.status !== 'submitted')
      throw new AppError(
        'conflict',
        `A claim that is ${claim.status} can't be given a payment schedule.`,
      );
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
    await seal(scope, projectId, claimId, 'schedule');
    return claimDetail(scope, projectId, claimId, false);
  }

  /**
   * The claim as a bill (subcontract, once its payment schedule is issued, for the scheduled amount) or an invoice
   * (head contract, once submitted, for the claim). Null when there is nothing to record: an invalid claim, or a
   * subcontract claim not yet scheduled. Internal: no permission check, called from jobs.
   */
  async function ledgerSource(scope: TenantScope, claimId: string): Promise<LedgerSource | null> {
    const [claim] = await scope.tx
      .select()
      .from(paymentClaims)
      .where(eq(paymentClaims.id, claimId))
      .limit(1);
    if (!claim || !claim.isValid) return null;
    const [contract] = await scope.tx
      .select()
      .from(contracts)
      .where(eq(contracts.id, claim.contractId))
      .limit(1);
    if (!contract) return null;
    const isBill = contract.kind === 'subcontract';
    const [schedule] = await scope.tx
      .select()
      .from(paymentSchedules)
      .where(eq(paymentSchedules.claimId, claimId))
      .limit(1);
    if (isBill && !schedule) return null;
    const rows = await scope.tx
      .select({
        itemCode: sovItems.code,
        itemDescription: sovItems.description,
        variationNumber: variations.number,
        variationTitle: variations.title,
        thisClaim: paymentClaimLines.thisClaim,
      })
      .from(paymentClaimLines)
      .leftJoin(sovItems, eq(sovItems.id, paymentClaimLines.sovItemId))
      .leftJoin(variations, eq(variations.id, paymentClaimLines.variationId))
      .where(eq(paymentClaimLines.claimId, claimId))
      // Schedule of values items in their order, then variations by number.
      .orderBy(asc(sovItems.sort), asc(variations.number));
    const retention = toCents(claim.retention);
    const payable = isBill ? toCents(schedule!.scheduledAmount) : toCents(claim.claimedNet);
    const lines = ledgerLines(
      rows.map((r) => ({
        // A variation line carries the cost code `VAR-n`, which the field map must map like any other (an unmapped
        // code becomes a sync issue naming it).
        code: r.itemCode ?? `VAR-${r.variationNumber}`,
        description: r.itemDescription ?? `Variation ${r.variationNumber}: ${r.variationTitle}`,
        thisClaim: toCents(r.thisClaim),
      })),
      retention,
      payable,
    );
    const companyId = isBill ? contract.payeeCompanyId : contract.payerCompanyId;
    const identity = companyId ? await deps.platform.companyIdentity(scope, companyId) : null;
    const timezone = (await deps.platform.getProject(scope, claim.projectId)).timezone;
    const date = isBill
      ? localDateOf(schedule!.issuedAt, timezone)
      : (claim.servedOn ?? claim.periodEnd);
    return {
      kind: isBill ? 'bill' : 'invoice',
      localType: isBill ? 'payment_schedule' : 'claim',
      localId: isBill ? schedule!.id : claim.id,
      contractNumber: contract.number,
      claimNumber: claim.number,
      counterparty:
        companyId && identity ? { companyId, name: identity.name, abn: identity.abn } : null,
      date,
      dueDate: claim.paymentDueOn ?? date,
      lines,
      retentionCents: retention,
    };
  }

  // ---- Variations (CLM-AC12/13) -------------------------------------------------------------------------------

  async function claimedAgainst(scope: TenantScope, variationId: string) {
    const [r] = await scope.tx
      .select({ taken: sql<string>`coalesce(sum(${paymentClaimLines.thisClaim}), 0)` })
      .from(paymentClaimLines)
      .innerJoin(paymentClaims, eq(paymentClaims.id, paymentClaimLines.claimId))
      .where(
        and(eq(paymentClaimLines.variationId, variationId), ne(paymentClaims.status, 'withdrawn')),
      );
    return fromCents(toCents(r?.taken ?? '0'));
  }

  async function withClaimed(scope: TenantScope, row: VariationRow) {
    return { variation: row, claimedToDate: await claimedAgainst(scope, row.id) };
  }

  async function variationRow(scope: TenantScope, projectId: string, variationId: string) {
    const [row] = await scope.tx
      .select()
      .from(variations)
      .where(and(eq(variations.id, variationId), eq(variations.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('financials.variation.not_found');
    return row;
  }

  async function createVariation(
    scope: TenantScope,
    projectId: string,
    contractId: string,
    input: CreateVariationInput,
  ) {
    await need(scope, 'financials.variations.manage', projectId);
    await requireStaff(scope, projectId, 'draft a variation');
    await getContractRow(scope, projectId, contractId);
    await lockContract(scope, contractId);
    if (toCents(input.amount) <= 0)
      throw new AppError('validation_failed', 'A variation must be for more than zero.', [
        { path: 'amount', message: 'Must be more than zero' },
      ]);
    const [n] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${variations.number}), 0) + 1` })
      .from(variations)
      .where(eq(variations.contractId, contractId));
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(variations)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        contractId,
        number: Number(n!.n),
        title: input.title.trim(),
        description: input.description?.trim() || null,
        amount: input.amount,
        timeImpactDays: input.timeImpactDays ?? 0,
        createdBy: scope.ctx.userId,
      })
      .returning();
    await recordRetention(scope, {
      recordType: 'financials.variations',
      recordId: id,
      projectId,
      category: 'sopa_evidence_10y',
      anchor: row!.createdAt,
    });
    return withClaimed(scope, row!);
  }

  async function listVariations(scope: TenantScope, projectId: string, contractId: string) {
    await need(scope, 'financials.contracts.read', projectId);
    await getContractRow(scope, projectId, contractId, false);
    const v = await viewer(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(variations)
      .where(
        and(
          eq(variations.contractId, contractId),
          v.isInternal ? undefined : inArray(variations.status, OUTSIDER_VISIBLE),
        ),
      )
      .orderBy(desc(variations.number));
    const out = [];
    for (const r of rows) out.push(await withClaimed(scope, r));
    const approvedTotal = rows
      .filter((r) => r.status === 'approved')
      .reduce((n, r) => n + toCents(r.amount), 0);
    return { rows: out, approvedTotal: fromCents(approvedTotal) };
  }

  async function getVariation(scope: TenantScope, projectId: string, variationId: string) {
    await need(scope, 'financials.contracts.read', projectId);
    const row = await variationRow(scope, projectId, variationId);
    await getContractRow(scope, projectId, row.contractId, false).catch(() => {
      throw new AppError('financials.variation.not_found');
    });
    // Drafts and withdrawn variations are internal: the payee only sees what has been put to them.
    if (!(await viewer(scope, projectId)).isInternal && !OUTSIDER_VISIBLE.includes(row.status))
      throw new AppError('financials.variation.not_found');
    return withClaimed(scope, row);
  }

  async function moveVariation(
    scope: TenantScope,
    projectId: string,
    variationId: string,
    to: 'submitted' | 'approved' | 'rejected' | 'withdrawn',
    note?: string,
  ) {
    const decide = to === 'approved' || to === 'rejected';
    await need(
      scope,
      decide ? 'financials.variations.decide' : 'financials.variations.manage',
      projectId,
    );
    await requireStaff(scope, projectId, decide ? 'decide a variation' : 'change a variation');
    const row = await variationRow(scope, projectId, variationId);
    const allowed: Record<string, string[]> = {
      submitted: ['draft'],
      approved: ['submitted'],
      rejected: ['submitted'],
      withdrawn: ['draft', 'submitted'],
    };
    if (!allowed[to]!.includes(row.status))
      throw new AppError(
        'financials.variation.bad_state',
        `A variation that is ${row.status} can't be ${to}.`,
      );
    if (to === 'rejected' && !(note ?? '').trim())
      throw new AppError(
        'financials.variation.reason_required',
        'Give the reason for rejecting this variation.',
        [{ path: 'note', message: 'Required when rejecting' }],
      );
    const at = now();
    const [updated] = await scope.tx
      .update(variations)
      .set({
        status: to,
        version: row.version + 1,
        ...(to === 'submitted' ? { submittedAt: at } : {}),
        ...(decide
          ? { decidedAt: at, decidedBy: scope.ctx.userId, decisionNote: note?.trim() || null }
          : {}),
      })
      .where(and(eq(variations.id, variationId), eq(variations.version, row.version)))
      .returning();
    if (!updated)
      throw new AppError('conflict', 'This variation just changed. Reload and try again.');
    scope.events.add({
      type: `financials.variation.${to}.v1`,
      projectId,
      entityType: 'variation',
      entityId: variationId,
      entityVersion: updated.version,
      data: { variationId, contractId: row.contractId, number: row.number, amount: row.amount },
    });
    return withClaimed(scope, updated);
  }

  /**
   * Records a payment a connector pulled from the accounting system (integrations/02 A7). Payments are append-only
   * facts: a reversal is a negative row pointing at the original. Safe to repeat (the same source and external
   * reference lands once). Internal: no permission check, called from jobs. Returns `unknown` when the record it names
   * is gone or, for a reversal, the original was never recorded here.
   */
  async function recordPayment(
    scope: TenantScope,
    input: PaymentInput,
  ): Promise<'recorded' | 'duplicate' | 'unknown'> {
    const claimId =
      input.localType === 'claim'
        ? input.localId
        : (
            await scope.tx
              .select({ claimId: paymentSchedules.claimId })
              .from(paymentSchedules)
              .where(eq(paymentSchedules.id, input.localId))
              .limit(1)
          )[0]?.claimId;
    if (!claimId || input.amountCents === 0) return 'unknown';
    const [claim] = await scope.tx
      .select({ id: paymentClaims.id, projectId: paymentClaims.projectId })
      .from(paymentClaims)
      .where(eq(paymentClaims.id, claimId))
      .limit(1);
    if (!claim) return 'unknown';
    let reversesPaymentId: string | null = null;
    if (input.amountCents < 0) {
      const [original] = input.reversesExternalRef
        ? await scope.tx
            .select({ id: payments.id })
            .from(payments)
            .where(
              and(
                eq(payments.source, input.source),
                eq(payments.externalRef, input.reversesExternalRef),
                eq(payments.claimId, claim.id),
              ),
            )
            .limit(1)
        : [];
      if (!original) return 'unknown';
      reversesPaymentId = original.id;
    }
    const id = uuidv7();
    const inserted = await scope.tx
      .insert(payments)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId: claim.projectId,
        claimId: claim.id,
        paidOn: input.paidOn,
        amount: fromCents(input.amountCents),
        reference: input.reference,
        source: input.source,
        externalRef: input.externalRef,
        reversesPaymentId,
      })
      .onConflictDoNothing()
      .returning({ id: payments.id });
    if (!inserted.length) return 'duplicate';
    scope.events.add({
      type: 'financials.payment.recorded.v1',
      projectId: claim.projectId,
      entityType: 'payment',
      entityId: id,
      entityVersion: 1,
      data: {
        paymentId: id,
        claimId: claim.id,
        paidOn: input.paidOn,
        amount: fromCents(input.amountCents),
        source: input.source,
        externalRef: input.externalRef,
        reversesPaymentId,
      },
    });
    return 'recorded';
  }

  return {
    ledgerSource,
    recordPayment,
    createVariation,
    listVariations,
    getVariation,
    moveVariation,
    createContract,
    listContracts,
    getContract,
    submitClaim,
    listClaims,
    claimDetail,
    issueSchedule,
    listEvidence,
    evidencePdf,
    evidenceJson,
  };
}

export type FinancialsService = ReturnType<typeof createFinancialsService>;
