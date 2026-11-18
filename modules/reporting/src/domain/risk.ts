// Nova project risk, first question: "which projects are at risk of a late SOPA payment schedule?" Pure rules, no IO.
// Every threshold and every sentence lives here, never in a model. A signal that could not be read is reported as
// unknown, never as fine.

/** A subcontract claim still waiting for a payment schedule is "near" when it falls due within this many days. */
export const DEADLINE_WINDOW_DAYS = 5;

export type RiskLevel = 'high' | 'medium' | 'low';
export type DeadlineState = 'overdue' | 'due_soon';
export type InsuranceState =
  'expired' | 'expires_before_payment_due' | 'current' | 'none_on_file' | 'not_visible';

export interface ClaimInput {
  claimId: string;
  claimNumber: number;
  contractNumber: number;
  contractTitle: string;
  subbieName: string | null;
  scheduleDueOn: string;
  paymentDueOn: string | null;
  claimedTotalCents: number;
}

/** What the wallet showed for one subcontractor. `unseen` = no grant, or the company isn't linked to an organisation. */
export interface InsuranceInput {
  unseen: boolean;
  docs: ReadonlyArray<{ title: string; expiresOn: string | null; expiry: string }>;
}

export interface SlipInput {
  restricted: boolean;
  hasProgramme: boolean;
  lateCount: number;
}

const DAY_MS = 86_400_000;
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

export function deadlineState(scheduleDueOn: string, today: string): DeadlineState | null {
  const left = daysBetween(today, scheduleDueOn);
  if (left < 0) return 'overdue';
  return left <= DEADLINE_WINDOW_DAYS ? 'due_soon' : null;
}

export function insuranceState(
  input: InsuranceInput | undefined,
  paymentDueOn: string | null,
): InsuranceState {
  if (!input || input.unseen) return 'not_visible';
  if (input.docs.length === 0) return 'none_on_file';
  if (input.docs.some((d) => d.expiry === 'expired')) return 'expired';
  if (paymentDueOn && input.docs.some((d) => d.expiresOn !== null && d.expiresOn <= paymentDueOn))
    return 'expires_before_payment_due';
  return 'current';
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

export interface ClaimRisk {
  claimId: string;
  claimNumber: number;
  contractNumber: number;
  contractTitle: string;
  subbieName: string | null;
  claimedTotal: string;
  scheduleDueOn: string;
  paymentDueOn: string | null;
  deadline: DeadlineState;
  daysToScheduleDue: number;
  insurance: InsuranceState;
  summary: string;
}

export function assessClaim(
  c: ClaimInput,
  today: string,
  insurance: InsuranceInput | undefined,
): ClaimRisk | null {
  const deadline = deadlineState(c.scheduleDueOn, today);
  if (!deadline) return null;
  const days = daysBetween(today, c.scheduleDueOn);
  const ins = insuranceState(insurance, c.paymentDueOn);
  const who = c.subbieName ?? `subcontract ${c.contractNumber}`;
  const when =
    deadline === 'overdue'
      ? `its payment schedule was due ${plural(-days)} ago (${c.scheduleDueOn}) and none is recorded`
      : days === 0
        ? `its payment schedule is due today (${c.scheduleDueOn})`
        : `its payment schedule is due in ${plural(days)} (${c.scheduleDueOn})`;
  const insText: Record<InsuranceState, string> = {
    expired: `${who} has an insurance on file that has expired`,
    expires_before_payment_due: `${who} has an insurance expiring on or before the payment due date`,
    current: '',
    none_on_file: `${who} has shared no insurance documents`,
    not_visible: `${who}'s insurance can't be seen (no wallet access)`,
  };
  return {
    claimId: c.claimId,
    claimNumber: c.claimNumber,
    contractNumber: c.contractNumber,
    contractTitle: c.contractTitle,
    subbieName: c.subbieName,
    claimedTotal: money(c.claimedTotalCents),
    scheduleDueOn: c.scheduleDueOn,
    paymentDueOn: c.paymentDueOn,
    deadline,
    daysToScheduleDue: days,
    insurance: ins,
    summary: `Claim ${c.claimNumber} from ${who} (${money(c.claimedTotalCents)}): ${when}.${insText[ins] ? ` ${insText[ins]}.` : ''}`,
  };
}

const INSURANCE_PROBLEM: ReadonlySet<InsuranceState> = new Set([
  'expired',
  'expires_before_payment_due',
]);

export interface ProjectRisk {
  level: RiskLevel;
  claims: ClaimRisk[];
  insuranceProblem: boolean;
  scheduleSlip: boolean;
  /** Things Nova couldn't read, so a missing signal never looks like "no risk". */
  unknown: string[];
}

/**
 * A project is listed only when it has a claim near or past its schedule deadline (the SOPA exposure). The two
 * aggravators are an insurance problem on a claiming subcontractor and programme slip. Both: high; one: medium;
 * neither: low, raised to medium when a schedule is already overdue.
 */
export function assessProject(
  claims: readonly ClaimRisk[],
  slip: SlipInput,
  claimsRestricted: boolean,
): ProjectRisk | null {
  if (claimsRestricted || claims.length === 0) return null;
  const insuranceProblem = claims.some((c) => INSURANCE_PROBLEM.has(c.insurance));
  const scheduleSlip = !slip.restricted && slip.hasProgramme && slip.lateCount > 0;
  const unknown: string[] = [];
  if (claims.some((c) => c.insurance === 'not_visible' || c.insurance === 'none_on_file'))
    unknown.push('insurance');
  if (slip.restricted) unknown.push('programme (no access)');
  else if (!slip.hasProgramme) unknown.push('programme (none loaded)');
  const factors = Number(insuranceProblem) + Number(scheduleSlip);
  const overdue = claims.some((c) => c.deadline === 'overdue');
  const level: RiskLevel = factors === 2 ? 'high' : factors === 1 || overdue ? 'medium' : 'low';
  return { level, claims: [...claims], insuranceProblem, scheduleSlip, unknown };
}

const RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

export function orderRisks<T extends { level: RiskLevel; name: string; claims: ClaimRisk[] }>(
  rows: readonly T[],
): T[] {
  const first = (r: T) => Math.min(...r.claims.map((c) => c.daysToScheduleDue));
  return [...rows].sort(
    (a, b) => RANK[a.level] - RANK[b.level] || first(a) - first(b) || a.name.localeCompare(b.name),
  );
}
