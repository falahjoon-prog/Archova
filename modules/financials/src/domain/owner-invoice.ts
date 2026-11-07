import { fromCents, percentOf, toCents } from './money';

export type OwnerInvoiceFlagCode =
  'duplicate' | 'outlier' | 'overclaim' | 'statement_missing' | 'invalid_claim';

export interface OwnerInvoiceFlag {
  code: OwnerInvoiceFlagCode;
  message: string;
}

/** A subcontractor claim as the pre-fill and the check see it (cents, ex GST). */
export interface SubClaimFacts {
  claimId: string;
  contractId: string;
  payeeCompanyId: string | null;
  number: number;
  periodEnd: string;
  completedToDateCents: number;
  thisPeriodCents: number;
  /** Revised contract sum: original value plus approved variations. */
  revisedSumCents: number;
  isValid: boolean;
  statementExpected: boolean;
  hasStatement: boolean;
}

const aud = (cents: number) => `$${fromCents(cents).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** A claim more than this many times the median of the contract's other claims is an outlier. */
export const OUTLIER_MULTIPLE = 3;

/**
 * Nova's check on the subcontractor claims being compiled (rule-based, no model). `all` is every live claim on the
 * project's subcontracts, so a duplicate is found even when its twin was already passed up on an earlier invoice;
 * flags come back only for the claims in `candidates`. A flag never blocks a claim, the person confirms it.
 */
export function checkSubClaims(
  candidates: SubClaimFacts[],
  all: SubClaimFacts[],
): Map<string, OwnerInvoiceFlag[]> {
  const out = new Map<string, OwnerInvoiceFlag[]>();
  for (const c of candidates) {
    const flags: OwnerInvoiceFlag[] = [];
    const twin = all.find(
      (o) =>
        o.claimId !== c.claimId &&
        o.periodEnd === c.periodEnd &&
        c.thisPeriodCents > 0 &&
        o.thisPeriodCents === c.thisPeriodCents &&
        (o.contractId === c.contractId ||
          (c.payeeCompanyId !== null && o.payeeCompanyId === c.payeeCompanyId)),
    );
    if (twin)
      flags.push({
        code: 'duplicate',
        message: `Possible duplicate of claim ${twin.number}: same period end and the same ${aud(c.thisPeriodCents)} this period.`,
      });
    const others = all
      .filter(
        (o) => o.contractId === c.contractId && o.claimId !== c.claimId && o.thisPeriodCents > 0,
      )
      .map((o) => o.thisPeriodCents);
    if (others.length >= 2) {
      const m = median(others);
      if (m > 0 && c.thisPeriodCents > OUTLIER_MULTIPLE * m)
        flags.push({
          code: 'outlier',
          message: `${aud(c.thisPeriodCents)} this period is more than ${OUTLIER_MULTIPLE}x the usual ${aud(m)} on this subcontract.`,
        });
    }
    if (c.revisedSumCents > 0 && c.completedToDateCents > c.revisedSumCents)
      flags.push({
        code: 'overclaim',
        message: `Completed to date ${aud(c.completedToDateCents)} is over the contract sum ${aud(c.revisedSumCents)}.`,
      });
    if (c.statementExpected && !c.hasStatement)
      flags.push({
        code: 'statement_missing',
        message: "The subcontractor's statement for this claim has not been recorded.",
      });
    if (!c.isValid)
      flags.push({
        code: 'invalid_claim',
        message: 'This claim was recorded as not a valid payment claim under the Act.',
      });
    out.set(c.claimId, flags);
  }
  return out;
}

/** Sub total, markup and total for an owner invoice, as decimal strings. `markupPct` is e.g. "12.50". */
export function ownerInvoiceTotals(amounts: string[], markupPct: string) {
  const sub = amounts.reduce((s, a) => s + toCents(a), 0);
  const markup = percentOf(sub, Math.round(Number(markupPct) * 100));
  return {
    subTotal: fromCents(sub),
    markupAmount: fromCents(markup),
    total: fromCents(sub + markup),
  };
}

export interface BackupInput {
  hasClaimPdf: boolean;
  hasSchedulePdf: boolean;
  statementExpected: boolean;
  hasStatement: boolean;
  statementSignedOn: string | null;
}

export type BackupItemKind = 'claim_pdf' | 'payment_schedule_pdf' | 'subcontractor_statement';
export type BackupItemStatus = 'attached' | 'missing' | 'not_required';

export interface BackupItem {
  kind: BackupItemKind;
  status: BackupItemStatus;
  /** For the statement: the day it was signed, when recorded. */
  detail: string | null;
}

/** What backs one subcontractor claim up in the pack the owner receives, and what is missing from it. */
export function backupItemsFor(b: BackupInput): BackupItem[] {
  return [
    { kind: 'claim_pdf', status: b.hasClaimPdf ? 'attached' : 'missing', detail: null },
    {
      kind: 'payment_schedule_pdf',
      status: b.hasSchedulePdf ? 'attached' : 'missing',
      detail: null,
    },
    {
      kind: 'subcontractor_statement',
      status: b.hasStatement ? 'attached' : b.statementExpected ? 'missing' : 'not_required',
      detail: b.statementSignedOn,
    },
  ];
}
