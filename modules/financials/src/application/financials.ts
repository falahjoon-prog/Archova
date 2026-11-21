import { and, asc, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
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
import { claimTimeline, mostUrgentStep } from '../domain/claim-timeline';
import {
  EMPTY_ADJUDICATION,
  validateAdjudication,
  type AdjudicationFacts,
} from '../domain/adjudication';
import { isScheduleLinesError, scheduleFromLines } from '../domain/schedule-lines';
import { SNAPSHOT_SCHEMA_VERSION } from '../domain/evidence';
import { PUBLIC_HOLIDAYS } from '../domain/holidays';
import { attachChangeEvent } from './changeEvents';
import { fromCents, isMoney, percentOf, toCents } from '../domain/money';
import { sealMessage, type EvidenceSigner } from '../domain/seal-proof';
import {
  canonicalJson,
  renderEvidencePdf,
  sha256Hex,
  type EvidenceKind,
  type EvidenceSnapshot,
} from '../domain/evidence';
import {
  claimAdjudications,
  claimStatements,
  contracts,
  costCodes,
  evidenceDeliveries,
  evidenceRecords,
  evidenceSendProofs,
  evidenceSendTimestamps,
  evidenceServiceRecords,
  evidenceServiceVoids,
  evidenceSignatures,
  evidenceTimestamps,
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
export type ClaimStatementRow = typeof claimStatements.$inferSelect;

export interface RecordStatementInput {
  periodEnd: string;
  receivedOn: string;
  signedOn?: string;
  note?: string;
}

/** The only claim warning so far. It warns; it never suggests withholding (compliance/05 §6, lawyer question open). */
export type ClaimWarning = 'subcontractor_statement_missing';

import type { WorkflowsService } from '@archova/mod-workflows';
import type { DayActivity } from './tmTickets';

export interface FinancialsDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject' | 'companyIdentity'>;
  /** Approval chains the organisation configured (`workflows`). Without it every variation uses the single approver. */
  workflows?: Pick<WorkflowsService, 'start' | 'decide' | 'cancel' | 'forSubject'>;
  now?: () => Date;
  /** Signs each sealed record. Without one, records are sealed by hash only (marked unsigned). */
  signer?: EvidenceSigner;
  /** Worked minutes per cost code (workforce timesheets), for labor productivity. Read lazily at request time. */
  timesheetMinutes: (
    scope: TenantScope,
    projectId: string,
  ) => Promise<{ costCodeId: string | null; minutes: number }[]>;
  /** The day's worked hours and equipment logs (workforce), for drafting T&M tickets. Read lazily at request time. */
  dayActivity: (scope: TenantScope, projectId: string, date: string) => Promise<DayActivity>;
  /** Whether the site diary has an entry on a date, for T&M ticket checks. Read lazily at request time. */
  diaryEntryExists: (scope: TenantScope, projectId: string, date: string) => Promise<boolean>;
  /** Files module lookup, for T&M sign-off evidence. */
  getFile: (
    scope: TenantScope,
    fileId: string,
  ) => Promise<{ projectId: string | null; status: string }>;
  /**
   * Subcontractor statutory declarations (`declarations`), read lazily at request time. When a project requires them,
   * issuing a payment schedule for money on a subcontract claim whose declarations are missing needs an
   * acknowledgement. The schedule is never refused outright: a late schedule can make the whole claim payable.
   */
  declarations?: {
    gate: (
      scope: TenantScope,
      projectId: string,
      input: { claimId: string; companyId: string; periodEnd: string; statementRecorded: boolean },
    ) => Promise<{ state: 'cleared' | 'warning' | 'blocked'; issues: { message: string }[] }>;
    recordOverride: (
      scope: TenantScope,
      projectId: string,
      input: { claimId: string; companyId: string; issues: string[]; reason: string },
    ) => Promise<void>;
  };
}

/** Largest PDF plus JSON attached to a service email; larger is blocked, never sent as a link (compliance/01 §4). */
export const MAX_EVIDENCE_EMAIL_BYTES = 10 * 1024 * 1024;
const DELIVERIES_PER_DAY = 5;
const CONFIRM_WITHIN_MS = 60 * 60 * 1000;
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

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
  /** Set when the contract is raised from an awarded tender quote; one quote raises at most one contract. */
  source?: { packageId: string; quoteId: string };
}

/** What an accounting system needs to record a claim, in cents and neutral of any provider (integrations/02 §2). */
export interface LedgerSource {
  kind: 'bill' | 'invoice';
  localType: 'payment_schedule' | 'claim';
  localId: string;
  /** Contract numbers restart in every project, so the project is part of what names a document in the ledger. */
  projectId: string;
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
  costCodeId?: string;
  /** The change event this variation prices; moves it to converted_to_variation. */
  changeEventId?: string;
}

type LineReasonRow = (typeof paymentSchedules.$inferInsert)['lineReasons'][number];

export interface IssueScheduleInput {
  /** The total, when scheduling the whole claim in one amount. Give this or `lines`, not both. */
  scheduledAmount?: string;
  /** Line by line: each reduced line needs its own reason. Lines left out are scheduled in full. */
  lines?: { sovItemId?: string; variationId?: string; scheduledAmount: string; reason?: string }[];
  /** With `lines` only: amounts withheld that are not about a line (set-offs, back-charges), each with its reason. */
  deductions?: { description: string; amount: string; reason: string }[];
  overallReason?: string;
  /** Goes ahead although a required declaration is missing (see `FinancialsDeps.declarations`). */
  declarationsOverride?: { reason: string };
  lineReasons?: { sovItemId: string; reason: string }[];
}

const OUTSIDER_VISIBLE = ['submitted', 'approved', 'rejected'];

const GST_TOTAL = (c: ClaimRow) => toCents(c.claimedTotal);

/** Caps so a sealed schedule always fits the 10 MB service email (PDF plus JSON), decided at issue not at send. */
export const MAX_LINE_REASON_CHARS = 1000;
export const MAX_SCHEDULE_REASON_CHARS = 20_000;

function assertReasonSizes(input: IssueScheduleInput) {
  const reasons = [
    ...(input.lines ?? []).map((l, n) => ({ path: `lines/${n}/reason`, text: l.reason ?? '' })),
    ...(input.deductions ?? []).map((d, n) => ({
      path: `deductions/${n}/reason`,
      text: `${d.description}${d.reason}`,
    })),
    ...(input.lineReasons ?? []).map((l, n) => ({
      path: `lineReasons/${n}/reason`,
      text: l.reason,
    })),
  ];
  const tooLong = reasons.find((r) => r.text.length > MAX_LINE_REASON_CHARS + 200);
  if (tooLong)
    throw new AppError(
      'validation_failed',
      `Keep each reason under ${MAX_LINE_REASON_CHARS} characters.`,
      [{ path: tooLong.path, message: `At most ${MAX_LINE_REASON_CHARS} characters` }],
    );
  const total = reasons.reduce((n, r) => n + r.text.length, 0) + (input.overallReason?.length ?? 0);
  if (total > MAX_SCHEDULE_REASON_CHARS)
    throw new AppError(
      'validation_failed',
      `The reasons on one schedule can total at most ${MAX_SCHEDULE_REASON_CHARS} characters.`,
      [{ path: 'lines', message: 'Total reason text too long' }],
    );
}

const toSignedCents = (amount: string) =>
  amount.startsWith('-') ? -toCents(amount.slice(1)) : toCents(amount);

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
        sourcePackageId: input.source?.packageId ?? null,
        sourceQuoteId: input.source?.quoteId ?? null,
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

  /** The contract already raised from this quote, if any (read by the award flow to stay idempotent). */
  async function contractForQuote(scope: TenantScope, projectId: string, quoteId: string) {
    await need(scope, 'financials.contracts.read', projectId);
    const [row] = await scope.tx
      .select()
      .from(contracts)
      .where(and(eq(contracts.projectId, projectId), eq(contracts.sourceQuoteId, quoteId)));
    return row ?? null;
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
    // NT uses the west-coast model (payment disputes) and has no rule row yet.
    if (!SOPA_RULES.some((r) => r.state === contract.sopaState))
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
    // The most urgent open step per claim, for the "needs attention" panel (rule-based, no model).
    const claimRows = rows.map((r) => r.claim);
    const ids = claimRows.map((c) => c.id);
    const [schedules, paidRows] = ids.length
      ? await Promise.all([
          scope.tx.select().from(paymentSchedules).where(inArray(paymentSchedules.claimId, ids)),
          scope.tx
            .select({
              claimId: payments.claimId,
              total: sql<string>`coalesce(sum(${payments.amount}), 0)`,
            })
            .from(payments)
            .where(inArray(payments.claimId, ids))
            .groupBy(payments.claimId),
        ])
      : [[], []];
    const scheduleBy = new Map(schedules.map((x) => [x.claimId, x]));
    const paidBy = new Map(paidRows.map((x) => [x.claimId, toSignedCents(x.total)]));
    const timeZone = (await deps.platform.getProject(scope, projectId)).timezone;
    const attention = new Map(
      claimRows.map((c) => {
        const sch = scheduleBy.get(c.id);
        const open = c.status !== 'withdrawn' && c.status !== 'paid';
        const step = open
          ? mostUrgentStep(
              claimTimeline({
                ruleState: c.ruleState,
                isValid: c.isValid,
                servedOn: c.servedOn,
                scheduleDueOn: c.scheduleDueOn,
                paymentDueOn: c.paymentDueOn,
                claimedTotalCents: toCents(c.claimedTotal),
                schedule: sch
                  ? { issuedAt: sch.issuedAt, scheduledCents: toCents(sch.scheduledAmount) }
                  : null,
                paidCents: paidBy.get(c.id) ?? 0,
                today: localToday,
                timeZone,
              }),
            )
          : null;
        return [c.id, step] as const;
      }),
    );
    return { rows: claimRows, today: localToday, attention };
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
    const [statement] = await scope.tx
      .select()
      .from(claimStatements)
      .where(eq(claimStatements.claimId, claimId))
      .limit(1);
    const [contract] = await scope.tx
      .select({ kind: contracts.kind, sopaState: contracts.sopaState })
      .from(contracts)
      .where(eq(contracts.id, claim.contractId))
      .limit(1);
    const warnings: ClaimWarning[] =
      statementExpected(contract) && !statement ? ['subcontractor_statement_missing'] : [];
    const timeZone = (await deps.platform.getProject(scope, projectId)).timezone;
    const today = localDateOf(now(), timeZone);
    const [paid] = await scope.tx
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(eq(payments.claimId, claimId));
    const [adjudication] = await scope.tx
      .select()
      .from(claimAdjudications)
      .where(eq(claimAdjudications.claimId, claimId))
      .limit(1);
    const timeline = claimTimeline({
      adjudication: adjudication ? adjudicationFacts(adjudication) : null,
      ruleState: claim.ruleState,
      isValid: claim.isValid,
      servedOn: claim.servedOn,
      scheduleDueOn: claim.scheduleDueOn,
      paymentDueOn: claim.paymentDueOn,
      claimedTotalCents: toCents(claim.claimedTotal),
      schedule: schedule
        ? { issuedAt: schedule.issuedAt, scheduledCents: toCents(schedule.scheduledAmount) }
        : null,
      paidCents: toSignedCents(paid?.total ?? '0'),
      today,
      timeZone,
    });
    return {
      claim,
      lines,
      schedule: schedule ?? null,
      statement: statement ?? null,
      adjudication: adjudication ?? null,
      warnings,
      today,
      timeline,
      attention: mostUrgentStep(timeline),
    };
  }

  const adjudicationFacts = (r: typeof claimAdjudications.$inferSelect): AdjudicationFacts => ({
    noticeServedOn: r.noticeServedOn,
    applicationLodgedOn: r.applicationLodgedOn,
    nominatingAuthority: r.nominatingAuthority,
    adjudicatorName: r.adjudicatorName,
    adjudicatorAppointedOn: r.adjudicatorAppointedOn,
    responseDueOn: r.responseDueOn,
    responseLodgedOn: r.responseLodgedOn,
    determinationDueOn: r.determinationDueOn,
    determinedOn: r.determinedOn,
    adjudicatedAmount: r.adjudicatedAmount,
    outcome: r.outcome,
    notes: r.notes,
  });

  /**
   * Record what has happened in adjudication on a claim (builder staff). The whole record is sent each time, so a
   * date that was wrong is corrected by sending it again; nothing here is calculated or chosen for the person.
   */
  async function recordAdjudication(
    scope: TenantScope,
    projectId: string,
    claimId: string,
    input: Partial<AdjudicationFacts>,
  ) {
    await need(scope, 'financials.claims.assess', projectId);
    await requireStaff(scope, projectId, 'record an adjudication');
    const { claim, today } = await claimDetail(scope, projectId, claimId, false);
    const text = (v: string | null | undefined) => v?.trim() || null;
    const facts: AdjudicationFacts = {
      ...EMPTY_ADJUDICATION,
      ...input,
      nominatingAuthority: text(input.nominatingAuthority),
      adjudicatorName: text(input.adjudicatorName),
      notes: text(input.notes),
      adjudicatedAmount: input.adjudicatedAmount ?? null,
    };
    if (facts.adjudicatedAmount !== null && !isMoney(facts.adjudicatedAmount))
      throw new AppError(
        'validation_failed',
        'Enter the adjudicated amount as dollars, like 12500.00.',
        [{ path: 'adjudicatedAmount', message: 'Not a dollar amount' }],
      );
    const problems = validateAdjudication(facts, { servedOn: claim.servedOn, today });
    if (problems.length > 0)
      throw new AppError(
        'validation_failed',
        problems[0]!.message,
        problems.map((p) => ({ path: p.path, message: p.message })),
      );
    const values = { ...facts, updatedBy: scope.ctx.userId };
    const [cur] = await scope.tx
      .select()
      .from(claimAdjudications)
      .where(eq(claimAdjudications.claimId, claimId))
      .limit(1);
    const at = new Date();
    const [row] = cur
      ? await scope.tx
          .update(claimAdjudications)
          .set({ ...values, updatedAt: at, version: cur.version + 1 })
          .where(eq(claimAdjudications.id, cur.id))
          .returning()
      : await scope.tx
          .insert(claimAdjudications)
          .values({ id: uuidv7(), orgId: scope.ctx.orgId, projectId, claimId, ...values })
          .returning();
    if (!cur)
      await recordRetention(scope, {
        recordType: 'financials.claim_adjudications',
        recordId: row!.id,
        projectId,
        category: 'financial_7y',
        anchor: at,
      });
    return claimDetail(scope, projectId, claimId, false);
  }

  /** NSW asks for a subcontractor's statement with each payment claim a subcontractor makes. */
  const statementExpected = (c?: { kind: string; sopaState: string }) =>
    c?.kind === 'subcontract' && c.sopaState === 'NSW';

  /**
   * Link the subcontractor's statement to a claim (compliance/05 §6): the period it covers, when it arrived and the
   * day it was signed. One per claim; recording again replaces it. Staff work, like recording the claim itself.
   */
  async function recordStatement(
    scope: TenantScope,
    projectId: string,
    claimId: string,
    input: RecordStatementInput,
  ) {
    await need(scope, 'financials.claims.record', projectId);
    await requireStaff(scope, projectId, 'record a subcontractor’s statement');
    const { claim } = await claimDetail(scope, projectId, claimId, false);
    const contract = await getContractRow(scope, projectId, claim.contractId);
    if (!statementExpected(contract))
      throw new AppError(
        'validation_failed',
        'A subcontractor’s statement applies to NSW subcontract claims.',
      );
    const today = localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);
    if (input.receivedOn > today)
      throw new AppError(
        'validation_failed',
        'The statement can’t have been received in the future.',
        [{ path: 'receivedOn', message: 'Must not be in the future' }],
      );
    if (input.signedOn && input.signedOn > input.receivedOn)
      throw new AppError('validation_failed', 'The statement was signed after it was received.', [
        { path: 'signedOn', message: 'Must not be after receivedOn' },
      ]);
    const values = {
      periodEnd: input.periodEnd,
      receivedOn: input.receivedOn,
      signedOn: input.signedOn ?? null,
      note: input.note?.trim() || null,
    };
    const [cur] = await scope.tx
      .select()
      .from(claimStatements)
      .where(eq(claimStatements.claimId, claimId))
      .limit(1);
    const at = new Date();
    const [row] = cur
      ? await scope.tx
          .update(claimStatements)
          .set({
            ...values,
            recordedBy: scope.ctx.userId,
            updatedAt: at,
            version: cur.version + 1,
          })
          .where(eq(claimStatements.id, cur.id))
          .returning()
      : await scope.tx
          .insert(claimStatements)
          .values({
            id: uuidv7(),
            orgId: scope.ctx.orgId,
            projectId,
            claimId,
            ...values,
            recordedBy: scope.ctx.userId,
          })
          .returning();
    scope.events.add({
      type: 'financials.claim_statement.recorded.v1',
      projectId,
      entityType: 'paymentClaim',
      entityId: claimId,
      entityVersion: row!.version,
      data: { claimId, periodEnd: values.periodEnd, receivedOn: values.receivedOn },
    });
    await recordRetention(scope, {
      recordType: 'financials.claim_statements',
      recordId: row!.id,
      projectId,
      category: 'financial_7y',
      anchor: at,
    });
    return claimDetail(scope, projectId, claimId, false);
  }

  /**
   * Sealed evidence (compliance/01 §4): in the transaction that records a claim or issues its schedule, take a
   * snapshot of everything it rests on, hash it, and render the PDF from that snapshot. The row is immutable.
   */
  /**
   * The contract's retention terms as they stood for this claim: the rate, the cap and what earlier claims already
   * held. Retention on a schedule is worked out from these, never scaled from the claim's net (Grace).
   */
  async function retentionContext(
    scope: TenantScope,
    claim: ClaimRow,
    contract: { retentionPct: string; retentionCapPct: string | null; originalValue: string },
  ) {
    const [h] = await scope.tx
      .select({ held: sql<string>`coalesce(sum(${paymentClaims.retention}), 0)` })
      .from(paymentClaims)
      .where(
        and(
          eq(paymentClaims.contractId, claim.contractId),
          ne(paymentClaims.status, 'withdrawn'),
          lt(paymentClaims.number, claim.number),
        ),
      );
    const pct = Math.round(Number(contract.retentionPct) * 100);
    const cap =
      contract.retentionCapPct === null
        ? null
        : Math.round(
            (toCents(contract.originalValue) * Math.round(Number(contract.retentionCapPct) * 100)) /
              10_000,
          );
    const held = toCents(h?.held ?? '0');
    const room = cap === null ? Infinity : Math.max(0, cap - held);
    return {
      pct,
      cap,
      held,
      retentionFor: (grossCents: number) => Math.min(percentOf(grossCents, pct), room),
    };
  }

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
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
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
      // Line by line (schema 2): every line with claimed and scheduled amounts, and the retention inputs.
      const isByLine = schedule.lineReasons.some(
        (r) => r.claimedAmount !== undefined || r.deductionAmount !== undefined,
      );
      let byLineSeal: Record<string, unknown> | null = null;
      if (isByLine) {
        const keyOf = (l: { sovItemId: string | null; variationId: string | null }) =>
          (l.sovItemId ?? l.variationId)!;
        const reducedBy = new Map(
          schedule.lineReasons
            .filter((r) => r.scheduledAmount !== undefined)
            .map((r) => [(r.sovItemId ?? r.variationId)!, r]),
        );
        const sealedLines = lines.map((l) => ({
          ref: refOf(l).ref,
          claimedAmount: l.thisClaim,
          scheduledAmount: reducedBy.get(keyOf(l))?.scheduledAmount ?? l.thisClaim,
        }));
        const scheduledGross = sealedLines.reduce((n, l) => n + toCents(l.scheduledAmount), 0);
        const deducted = schedule.lineReasons.reduce(
          (n, r) => n + (r.deductionAmount ? toCents(r.deductionAmount) : 0),
          0,
        );
        const ret = await retentionContext(scope, claim, contract);
        byLineSeal = {
          byLine: true,
          lines: sealedLines,
          claimedGross: fromCents(lines.reduce((n, l) => n + toCents(l.thisClaim), 0)),
          scheduledGross: fromCents(scheduledGross),
          retention: {
            ratePct: (ret.pct / 100).toFixed(2),
            cap: ret.cap === null ? null : fromCents(ret.cap),
            heldBefore: fromCents(ret.held),
            onClaim: claim.retention,
            onSchedule: fromCents(scheduledGross - toCents(schedule.scheduledAmount) - deducted),
          },
        };
      }
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
          ...(byLineSeal ? byLineSeal : {}),
          lineReasons: schedule.lineReasons.map((r) => ({
            ref:
              r.description ??
              refOf({ sovItemId: r.sovItemId ?? null, variationId: r.variationId ?? null }).ref,
            reason: r.reason,
            ...(r.claimedAmount !== undefined ? { claimedAmount: r.claimedAmount } : {}),
            ...(r.scheduledAmount !== undefined ? { scheduledAmount: r.scheduledAmount } : {}),
            ...(r.deductionAmount !== undefined ? { deductionAmount: r.deductionAmount } : {}),
          })),
          issuedAt: schedule.issuedAt.toISOString(),
          issuedWithinTime: schedule.issuedWithinTime,
        },
      };
    }
    const snapshotText = canonicalJson(snapshot);
    const snapshotSha256 = sha256Hex(snapshotText);
    const pdf = Buffer.from(await renderEvidencePdf(snapshot, snapshotSha256));
    const evidenceId = uuidv7();
    const pdfSha256 = sha256Hex(pdf);
    await scope.tx.insert(evidenceRecords).values({
      id: evidenceId,
      orgId: scope.ctx.orgId,
      projectId,
      claimId,
      kind,
      sealedAt,
      snapshot: JSON.parse(snapshotText),
      snapshotText,
      snapshotSha256,
      pdf,
      pdfSha256,
    });
    if (deps.signer) {
      const message = sealMessage({
        kind,
        claimId,
        sealedAt: sealedAt.toISOString(),
        snapshotSha256,
        pdfSha256,
      });
      await scope.tx.insert(evidenceSignatures).values({
        evidenceId,
        orgId: scope.ctx.orgId,
        keyId: deps.signer.keyId,
        algorithm: 'ed25519',
        message,
        signature: deps.signer.sign(message),
      });
    }
  }

  /** Evidence for a claim the viewer may see, each record re-hashed so a changed row shows as not intact. */
  async function listEvidence(scope: TenantScope, projectId: string, claimId: string) {
    await claimDetail(scope, projectId, claimId, true);
    const rows = await scope.tx
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.claimId, claimId))
      .orderBy(asc(evidenceRecords.sealedAt));
    const ids = rows.map((r) => r.id);
    const sigs = ids.length
      ? await scope.tx
          .select()
          .from(evidenceSignatures)
          .where(inArray(evidenceSignatures.evidenceId, ids))
      : [];
    const stamps = ids.length
      ? await scope.tx
          .select()
          .from(evidenceTimestamps)
          .where(inArray(evidenceTimestamps.evidenceId, ids))
      : [];
    return rows.map((r) => {
      const intact =
        sha256Hex(r.snapshotText) === r.snapshotSha256 && sha256Hex(r.pdf) === r.pdfSha256;
      const sig = sigs.find((x) => x.evidenceId === r.id);
      // A timestamp with no pinned chain was never verified in-app, so it is not shown as one.
      const stamp = stamps.find((x) => x.evidenceId === r.id && x.caChainPem !== '');
      const message = sealMessage({
        kind: r.kind,
        claimId: r.claimId,
        sealedAt: r.sealedAt.toISOString(),
        snapshotSha256: r.snapshotSha256,
        pdfSha256: r.pdfSha256,
      });
      return {
        kind: r.kind,
        sealedAt: r.sealedAt,
        snapshotSha256: r.snapshotSha256,
        pdfSha256: r.pdfSha256,
        pdfBytes: r.pdf.length,
        intact,
        signature: sig
          ? {
              keyId: sig.keyId,
              algorithm: sig.algorithm,
              signatureBase64: sig.signature,
              message: sig.message,
              publicKeyPem: deps.signer?.publicKeyFor(sig.keyId) ?? null,
              // null when this server no longer holds that key, so it cannot say either way
              valid: deps.signer?.publicKeyFor(sig.keyId)
                ? sig.message === message &&
                  deps.signer.verify(sig.message, sig.signature, sig.keyId)
                : null,
            }
          : null,
        timestamp: stamp
          ? {
              authority: stamp.authority,
              time: stamp.genTime,
              imprintSha256: stamp.imprintSha256,
              serialHex: stamp.serialHex,
              tokenBase64: stamp.token.toString('base64'),
              caChainPem: stamp.caChainPem,
            }
          : null,
      };
    });
  }

  /**
   * Queue the sealed record for email to an address the payer gave for service. The PDF and the JSON go as
   * attachments, never as a link (compliance/01 §4). The worker sends it; service time is the receiving server's
   * delivery confirmation, not this request.
   */
  async function queueEvidenceDelivery(
    scope: TenantScope,
    projectId: string,
    claimId: string,
    kind: EvidenceKind,
    recipientEmail: string,
    addressBasis?: string | null,
  ) {
    await need(
      scope,
      kind === 'schedule' ? 'financials.claims.assess' : 'financials.claims.record',
      projectId,
    );
    await requireStaff(scope, projectId, 'serve a claim by email');
    const email = recipientEmail.trim();
    if (!EMAIL.test(email) || email.length > 254)
      throw new AppError('validation_failed', 'Enter a valid email address.', [
        { path: 'recipientEmail', message: 'Not a valid email address' },
      ]);
    // Serialise per claim so two requests cannot both pass the daily cap.
    await scope.tx
      .select({ id: paymentClaims.id })
      .from(paymentClaims)
      .where(eq(paymentClaims.id, claimId))
      .for('update');
    const { row } = await evidenceFile(scope, projectId, claimId, kind);
    if (row.pdf.length + Buffer.byteLength(row.snapshotText) > MAX_EVIDENCE_EMAIL_BYTES)
      throw new AppError(
        'conflict',
        'This record is too large to attach to an email. Serve it another way; Archova does not send a link instead.',
      );
    const recent = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(evidenceDeliveries)
      .where(
        and(
          eq(evidenceDeliveries.claimId, claimId),
          eq(evidenceDeliveries.kind, kind),
          sql`${evidenceDeliveries.queuedAt} > ${now()}::timestamptz - interval '1 day'`,
        ),
      );
    if ((recent[0]?.n ?? 0) >= DELIVERIES_PER_DAY)
      throw new AppError('conflict', 'This record has already been emailed several times today.');
    const [created] = await scope.tx
      .insert(evidenceDeliveries)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        claimId,
        evidenceId: row.id,
        kind,
        recipientEmail: email,
        addressBasis: addressBasis?.trim().slice(0, 500) || null,
        queuedBy: scope.ctx.userId,
        queuedAt: now(),
      })
      .returning();
    return deliveryView(created!);
  }

  type SendProofSummary = {
    recordedAt: Date;
    messageSha256: string;
    signed: boolean;
    timestampedAt: Date | null;
  };

  function deliveryView(
    d: typeof evidenceDeliveries.$inferSelect,
    proof: SendProofSummary | null = null,
  ) {
    const open = d.status === 'queued' || d.status === 'sending' || d.status === 'sent';
    return {
      id: d.id,
      kind: d.kind,
      recipientEmail: d.recipientEmail,
      addressBasis: d.addressBasis,
      status: d.status,
      queuedAt: d.queuedAt,
      sentAt: d.sentAt,
      deliveredAt: d.deliveredAt,
      bouncedAt: d.bouncedAt,
      // `sentAt` is when our relay took the message; it is not delivery. `deliveredAt` is the recipient side only.
      // `confirmed_delivery` is the only basis that shows service by email. A send proof is our own record of
      // dispatch: it says what we sent and when, never that it arrived.
      serviceBasis: (d.deliveredAt !== null ? 'confirmed_delivery' : 'dispatch_only') as
        'confirmed_delivery' | 'dispatch_only',
      sendProof: proof,
      // Service counts from delivery confirmation only. Anything else after an hour must be served another way.
      notConfirmed:
        d.status === 'bounced' ||
        d.status === 'failed' ||
        (open &&
          d.deliveredAt === null &&
          now().getTime() - d.queuedAt.getTime() > CONFIRM_WITHIN_MS),
    };
  }

  async function listEvidenceDeliveries(scope: TenantScope, projectId: string, claimId: string) {
    await claimDetail(scope, projectId, claimId, true);
    await requireStaff(scope, projectId, 'see email deliveries');
    const rows = await scope.tx
      .select()
      .from(evidenceDeliveries)
      .where(eq(evidenceDeliveries.claimId, claimId))
      .orderBy(desc(evidenceDeliveries.queuedAt));
    const proofs = await scope.tx
      .select({
        deliveryId: evidenceSendProofs.deliveryId,
        recordedAt: evidenceSendProofs.recordedAt,
        messageSha256: evidenceSendProofs.messageSha256,
        signature: evidenceSendProofs.signature,
        stamped: evidenceSendTimestamps.genTime,
      })
      .from(evidenceSendProofs)
      .leftJoin(
        evidenceSendTimestamps,
        eq(evidenceSendTimestamps.deliveryId, evidenceSendProofs.deliveryId),
      )
      .where(
        inArray(
          evidenceSendProofs.deliveryId,
          rows.map((r) => r.id),
        ),
      );
    const byId = new Map(proofs.map((p) => [p.deliveryId, p]));
    return rows.map((d) => {
      const p = byId.get(d.id);
      return deliveryView(
        d,
        p
          ? {
              recordedAt: p.recordedAt,
              messageSha256: p.messageSha256,
              signed: p.signature !== null,
              timestampedAt: p.stamped,
            }
          : null,
      );
    });
  }

  const SERVICE_METHODS = ['hand', 'courier', 'post', 'recipient_reply', 'other'] as const;
  type ServiceMethod = (typeof SERVICE_METHODS)[number];

  /**
   * A record that the sealed claim or schedule was served by other means (by hand, courier, post, or the recipient's
   * own reply), made by a person who knows when it reached the recipient. It is kept apart from email deliveries so
   * it is never mistaken for a confirmed delivery, and it cannot be edited or removed.
   */
  async function recordEvidenceService(
    scope: TenantScope,
    projectId: string,
    claimId: string,
    kind: EvidenceKind,
    input: { method: string; servedAt: Date; servedTo: string; note?: string | null },
  ) {
    await need(
      scope,
      kind === 'schedule' ? 'financials.claims.assess' : 'financials.claims.record',
      projectId,
    );
    await requireStaff(scope, projectId, 'record service');
    const { row } = await evidenceFile(scope, projectId, claimId, kind);
    if (!(SERVICE_METHODS as readonly string[]).includes(input.method))
      throw new AppError('validation_failed', 'Choose how it was served.', [
        { path: 'method', message: 'Not a service method' },
      ]);
    const servedTo = input.servedTo.trim();
    if (servedTo.length < 1 || servedTo.length > 200)
      throw new AppError('validation_failed', 'Say who it was served on.', [
        { path: 'servedTo', message: 'Required, up to 200 characters' },
      ]);
    if (
      Number.isNaN(input.servedAt.getTime()) ||
      input.servedAt.getTime() > now().getTime() + 5 * 60 * 1000 ||
      input.servedAt.getTime() < row.sealedAt.getTime()
    )
      throw new AppError(
        'validation_failed',
        'The time served must be after the record was sealed and not in the future.',
        [{ path: 'servedAt', message: 'Out of range' }],
      );
    const note = input.note?.trim() || null;
    if (note && note.length > 2000)
      throw new AppError('validation_failed', 'The note is too long.', [
        { path: 'note', message: 'Up to 2000 characters' },
      ]);
    const [created] = await scope.tx
      .insert(evidenceServiceRecords)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        claimId,
        evidenceId: row.id,
        kind,
        method: input.method as ServiceMethod,
        servedAt: input.servedAt,
        servedTo,
        note,
        basis: 'self_reported' as const,
        recordedBy: scope.ctx.userId,
        recordedAt: now(),
      })
      .returning();
    await recordRetention(scope, {
      recordType: 'financials.evidence_service_records',
      recordId: created!.id,
      projectId,
      category: 'sopa_evidence_10y',
      anchor: created!.recordedAt,
    });
    // The note text is left out of the event: it is free text that may name people.
    scope.events.add({
      type: 'financials.evidence_service.recorded.v1',
      projectId,
      entityType: 'paymentClaim',
      entityId: claimId,
      entityVersion: 1,
      data: {
        claimId,
        kind,
        serviceRecordId: created!.id,
        method: created!.method,
        servedAt: created!.servedAt.toISOString(),
        selfReported: true,
      },
    });
    return created!;
  }

  /** Corrects a mistaken service record by voiding it with a reason. The record itself is never changed. */
  async function voidEvidenceService(
    scope: TenantScope,
    projectId: string,
    claimId: string,
    recordId: string,
    reason: string,
  ) {
    await requireStaff(scope, projectId, 'void a service record');
    const [rec] = await scope.tx
      .select()
      .from(evidenceServiceRecords)
      .where(
        and(eq(evidenceServiceRecords.id, recordId), eq(evidenceServiceRecords.claimId, claimId)),
      );
    if (!rec) throw new AppError('not_found', 'Service record not found.');
    await need(
      scope,
      rec.kind === 'schedule' ? 'financials.claims.assess' : 'financials.claims.record',
      projectId,
    );
    const why = reason.trim();
    if (why.length < 1 || why.length > 1000)
      throw new AppError('validation_failed', 'Give the reason it is being voided.', [
        { path: 'reason', message: 'Required, up to 1000 characters' },
      ]);
    const [v] = await scope.tx
      .insert(evidenceServiceVoids)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        recordId,
        reason: why,
        voidedBy: scope.ctx.userId,
        voidedAt: now(),
      })
      .onConflictDoNothing()
      .returning();
    if (!v) throw new AppError('conflict', 'This service record is already void.');
    await recordRetention(scope, {
      recordType: 'financials.evidence_service_voids',
      recordId: v.id,
      projectId,
      category: 'sopa_evidence_10y',
      anchor: v.voidedAt,
    });
    scope.events.add({
      type: 'financials.evidence_service.voided.v1',
      projectId,
      entityType: 'paymentClaim',
      entityId: claimId,
      entityVersion: 1,
      data: { claimId, serviceRecordId: recordId },
    });
    return { ...rec, voidedAt: v.voidedAt, voidReason: why };
  }

  async function listEvidenceServiceRecords(
    scope: TenantScope,
    projectId: string,
    claimId: string,
  ) {
    await claimDetail(scope, projectId, claimId, true);
    await requireStaff(scope, projectId, 'see service records');
    const rows = await scope.tx
      .select({
        r: evidenceServiceRecords,
        voidedAt: evidenceServiceVoids.voidedAt,
        voidReason: evidenceServiceVoids.reason,
      })
      .from(evidenceServiceRecords)
      .leftJoin(evidenceServiceVoids, eq(evidenceServiceVoids.recordId, evidenceServiceRecords.id))
      .where(eq(evidenceServiceRecords.claimId, claimId))
      .orderBy(desc(evidenceServiceRecords.servedAt));
    return rows.map((x) => ({ ...x.r, voidedAt: x.voidedAt, voidReason: x.voidReason }));
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
   * Scheduling money on a subcontract claim while a required declaration is missing needs an acknowledgement from
   * someone allowed to give it. This never stops a schedule being issued in time, and a schedule for nothing is not
   * asked about: Archova does not suggest withholding for a missing declaration (compliance/05 §6).
   */
  async function checkDeclarations(
    scope: TenantScope,
    projectId: string,
    claim: ClaimRow,
    scheduledCents: number,
    override: { reason: string } | undefined,
  ) {
    if (!deps.declarations || scheduledCents <= 0) return;
    const contract = await getContractRow(scope, projectId, claim.contractId);
    if (contract.kind !== 'subcontract' || !contract.payeeCompanyId) return;
    const [statement] = await scope.tx
      .select({ id: claimStatements.id })
      .from(claimStatements)
      .where(eq(claimStatements.claimId, claim.id))
      .limit(1);
    const gate = await deps.declarations.gate(scope, projectId, {
      claimId: claim.id,
      companyId: contract.payeeCompanyId,
      periodEnd: claim.periodEnd,
      statementRecorded: Boolean(statement),
    });
    if (gate.state !== 'blocked') return;
    const issues = gate.issues.map((i) => i.message);
    if (!override)
      throw new AppError(
        'financials.schedule.declarations_missing',
        'A declaration this project requires is missing for this subcontractor. Get it, or acknowledge and go ahead.',
        [{ path: 'declarationsOverride', message: issues.join(' ') }],
      );
    await need(scope, 'declarations.statements.override', projectId);
    await deps.declarations.recordOverride(scope, projectId, {
      claimId: claim.id,
      companyId: contract.payeeCompanyId,
      issues,
      reason: override.reason,
    });
  }

  /**
   * Open subcontract claims (submitted, valid, no schedule yet) for the declarations register. Internal: the caller
   * has already checked its own permission.
   */
  async function openSubcontractClaims(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select({
        claimId: paymentClaims.id,
        number: paymentClaims.number,
        contractId: contracts.id,
        contractTitle: contracts.title,
        payeeCompanyId: contracts.payeeCompanyId,
        periodEnd: paymentClaims.periodEnd,
        statementId: claimStatements.id,
      })
      .from(paymentClaims)
      .innerJoin(contracts, eq(contracts.id, paymentClaims.contractId))
      .leftJoin(claimStatements, eq(claimStatements.claimId, paymentClaims.id))
      .where(
        and(
          eq(paymentClaims.projectId, projectId),
          eq(paymentClaims.status, 'submitted'),
          eq(paymentClaims.isValid, true),
          eq(contracts.kind, 'subcontract'),
        ),
      )
      .orderBy(asc(paymentClaims.periodEnd), asc(paymentClaims.number));
    return rows.flatMap((r) =>
      r.payeeCompanyId
        ? [
            {
              claimId: r.claimId,
              number: r.number,
              contractId: r.contractId,
              contractTitle: r.contractTitle,
              payeeCompanyId: r.payeeCompanyId,
              periodEnd: r.periodEnd,
              statementRecorded: r.statementId !== null,
            },
          ]
        : [],
    );
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
    const {
      claim,
      schedule,
      lines: claimLines,
    } = await claimDetail(scope, projectId, claimId, false);
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
    if (input.lines && input.scheduledAmount !== undefined)
      throw new AppError(
        'validation_failed',
        'Give the schedule line by line or as one amount, not both.',
        [{ path: 'scheduledAmount', message: 'Leave out when scheduling by line' }],
      );
    if (!input.lines && input.scheduledAmount === undefined)
      throw new AppError('validation_failed', 'Give the scheduled amount.', [
        { path: 'scheduledAmount', message: 'Required' },
      ]);
    assertReasonSizes(input);
    if (input.deductions && !input.lines)
      throw new AppError('validation_failed', 'Deductions go with a line by line schedule.', [
        { path: 'deductions', message: 'Give lines as well' },
      ]);
    // By line: the total comes from the lines, every reduced line carries its own reason, and retention is
    // recalculated from the contract's terms on what is scheduled.
    let byLine: { lineReasons: LineReasonRow[]; scheduledNet: number } | null = null;
    if (input.lines) {
      const contractRow = await getContractRow(scope, projectId, claim.contractId);
      const ret = await retentionContext(scope, claim, contractRow);
      const r = scheduleFromLines(
        claimLines.map((l) => ({
          sovItemId: l.sovItemId,
          variationId: l.variationId,
          thisClaim: toSignedCents(l.thisClaim),
        })),
        input.lines.map((l) => ({
          ...(l.sovItemId ? { sovItemId: l.sovItemId } : {}),
          ...(l.variationId ? { variationId: l.variationId } : {}),
          scheduledAmount: toCents(l.scheduledAmount),
          ...(l.reason ? { reason: l.reason } : {}),
        })),
        {
          claimNetCents: net,
          retentionFor: ret.retentionFor,
          deductions: (input.deductions ?? []).map((d) => ({
            description: d.description,
            amount: toCents(d.amount),
            reason: d.reason,
          })),
        },
      );
      if (isScheduleLinesError(r)) {
        if (r.code === 'reason_missing')
          throw new AppError(
            'financials.schedule.line_reason_required',
            'Give a reason of at least 10 characters for every line you are scheduling for less than the claim.',
            r.keys.map((k) => ({
              path: `lines/${k}/reason`,
              message: 'At least 10 characters, for a reduced line',
            })),
          );
        throw new AppError(
          'validation_failed',
          r.code === 'over_line'
            ? 'A line cannot be scheduled for more than the claim took on it.'
            : r.code === 'deduction_invalid'
              ? 'Each deduction needs a description, an amount above zero and a reason of at least 10 characters.'
              : r.code === 'deductions_exceed'
                ? 'The deductions are more than the amount left to schedule.'
                : 'That line is not on this claim, or is given twice.',
          [
            {
              path: r.code === 'deduction_invalid' ? `deductions/${r.index}` : 'lines',
              message: r.code,
            },
          ],
        );
      }
      byLine = {
        scheduledNet: r.scheduledNet,
        lineReasons: [
          ...r.lines
            .filter((l) => l.scheduledAmount < l.claimedAmount)
            .map((l) => ({
              ...(l.sovItemId ? { sovItemId: l.sovItemId } : {}),
              ...(l.variationId ? { variationId: l.variationId } : {}),
              reason: l.reason!,
              claimedAmount: fromCents(l.claimedAmount),
              scheduledAmount: fromCents(l.scheduledAmount),
            })),
          ...r.deductions.map((d) => ({
            description: d.description,
            reason: d.reason,
            deductionAmount: fromCents(d.amount),
          })),
        ],
      };
    }
    const scheduled = byLine ? byLine.scheduledNet : toCents(input.scheduledAmount!);
    if (scheduled > net)
      throw new AppError(
        'financials.schedule.over_claim',
        'A payment schedule cannot be for more than the claim.',
        [{ path: 'scheduledAmount', message: `At most ${claim.claimedNet}` }],
      );
    const reasoned =
      (input.overallReason ?? '').trim().length > 0 ||
      (input.lineReasons ?? []).length > 0 ||
      (byLine?.lineReasons.length ?? 0) > 0;
    if (scheduled < net && !reasoned)
      throw new AppError(
        'financials.schedule.reason_required',
        'Give a reason for every reduction before issuing a schedule for less than the claim.',
        [{ path: 'overallReason', message: 'Required when scheduling less than claimed' }],
      );
    await checkDeclarations(scope, projectId, claim, scheduled, input.declarationsOverride);
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
        lineReasons: byLine ? byLine.lineReasons : (input.lineReasons ?? []),
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
      projectId: claim.projectId,
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

  async function requireCostCode(scope: TenantScope, projectId: string, costCodeId: string) {
    const [found] = await scope.tx
      .select({ id: costCodes.id, archived: costCodes.archived })
      .from(costCodes)
      .where(and(eq(costCodes.projectId, projectId), eq(costCodes.id, costCodeId)));
    if (!found)
      throw new AppError(
        'financials.cost_code.not_found',
        'That cost code is not on this project.',
      );
    if (found.archived)
      throw new AppError('validation_failed', 'That cost code is archived.', [
        { path: 'costCodeId', message: 'Archived' },
      ]);
  }

  /** Tags (or clears) a variation's cost code. Money does not change, so any state but withdrawn/rejected will do. */
  async function setVariationCostCode(
    scope: TenantScope,
    projectId: string,
    variationId: string,
    costCodeId: string | null,
  ) {
    await need(scope, 'financials.variations.manage', projectId);
    await requireStaff(scope, projectId, 'code a variation');
    const row = await variationRow(scope, projectId, variationId);
    if (row.status === 'withdrawn' || row.status === 'rejected')
      throw new AppError(
        'financials.variation.bad_state',
        `A variation that is ${row.status} can't be coded.`,
      );
    if (costCodeId) await requireCostCode(scope, projectId, costCodeId);
    const [updated] = await scope.tx
      .update(variations)
      .set({ costCodeId, version: row.version + 1 })
      .where(and(eq(variations.id, variationId), eq(variations.version, row.version)))
      .returning();
    if (!updated)
      throw new AppError('conflict', 'This variation just changed. Reload and try again.');
    scope.events.add({
      type: 'financials.variation.coded.v1',
      projectId,
      entityType: 'variation',
      entityId: variationId,
      entityVersion: updated.version,
      data: { variationId, contractId: row.contractId, costCodeId },
    });
    return withClaimed(scope, updated);
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
    if (input.costCodeId) await requireCostCode(scope, projectId, input.costCodeId);
    if (input.changeEventId)
      await attachChangeEvent(scope, projectId, input.changeEventId, 'converted_to_variation');
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
        costCodeId: input.costCodeId ?? null,
        changeEventId: input.changeEventId ?? null,
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
    // A configured approval chain takes over the decision: each step is someone's call, and only the last approval (or
    // any rejection) moves the variation itself. Without a chain the single approver decides, as before.
    if (decide && deps.workflows) {
      const step = await deps.workflows.decide(scope, {
        subjectType: 'financials.variation',
        subjectId: variationId,
        decision: to === 'approved' ? 'approved' : 'rejected',
        note,
      });
      if (step?.outcome === 'advanced') return withClaimed(scope, row);
    }
    if (to === 'withdrawn' && deps.workflows)
      await deps.workflows.cancel(scope, 'financials.variation', variationId);
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
    if (to === 'submitted' && deps.workflows)
      await deps.workflows.start(scope, {
        projectId,
        subjectType: 'financials.variation',
        subjectId: variationId,
        amount: row.amount,
      });
    return withClaimed(scope, updated);
  }

  /** Where a variation is in its approval chain, or null when no chain applied. */
  async function getVariationWorkflow(scope: TenantScope, projectId: string, variationId: string) {
    const { variation } = await getVariation(scope, projectId, variationId);
    if (!(await viewer(scope, projectId)).isInternal)
      throw new AppError('financials.variation.not_found');
    return deps.workflows
      ? deps.workflows.forSubject(scope, 'financials.variation', variation.id)
      : null;
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

  /**
   * Nova project risk (`reporting`): subcontract claims still waiting for a payment schedule, with their deadlines.
   * Builder staff holding `financials.claims.read` only; `restricted` otherwise, so the caller says "couldn't see"
   * rather than "no risk". No dates are computed here: the stored statutory dates are returned as recorded.
   */
  async function sopaRiskSignals(scope: TenantScope, projectId: string) {
    if (
      scope.ctx.principalType !== 'member' ||
      !(await deps.access.can(scope, 'financials.claims.read', { projectId }))
    )
      return { restricted: true as const, claims: [] };
    const rows = await scope.tx
      .select({
        claimId: paymentClaims.id,
        claimNumber: paymentClaims.number,
        contractId: contracts.id,
        contractNumber: contracts.number,
        contractTitle: contracts.title,
        payeeCompanyId: contracts.payeeCompanyId,
        scheduleDueOn: paymentClaims.scheduleDueOn,
        paymentDueOn: paymentClaims.paymentDueOn,
        claimedTotal: paymentClaims.claimedTotal,
      })
      .from(paymentClaims)
      .innerJoin(contracts, eq(contracts.id, paymentClaims.contractId))
      .where(
        and(
          eq(paymentClaims.projectId, projectId),
          eq(contracts.kind, 'subcontract'),
          eq(paymentClaims.isValid, true),
          eq(paymentClaims.status, 'submitted'),
          sql`${paymentClaims.scheduleDueOn} is not null`,
        ),
      )
      .orderBy(asc(paymentClaims.scheduleDueOn))
      .limit(200);
    return {
      restricted: false as const,
      claims: rows.map((r) => ({
        ...r,
        scheduleDueOn: r.scheduleDueOn!,
        claimedTotalCents: toCents(r.claimedTotal),
      })),
    };
  }

  return {
    contractFor: getContractRow,
    requireStaff,
    sopaRiskSignals,
    ledgerSource,
    recordPayment,
    createVariation,
    setVariationCostCode,
    listVariations,
    getVariation,
    moveVariation,
    getVariationWorkflow,
    createContract,
    contractForQuote,
    listContracts,
    getContract,
    submitClaim,
    listClaims,
    claimDetail,
    recordStatement,
    recordAdjudication,
    issueSchedule,
    openSubcontractClaims,
    listEvidence,
    queueEvidenceDelivery,
    listEvidenceDeliveries,
    recordEvidenceService,
    voidEvidenceService,
    listEvidenceServiceRecords,
    evidencePdf,
    evidenceJson,
  };
}

export type FinancialsService = ReturnType<typeof createFinancialsService>;
