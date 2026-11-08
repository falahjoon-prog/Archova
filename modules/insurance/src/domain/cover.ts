// Insurance and bonds register: the rules, with no I/O. Status words come from the expiry date and the project's own
// calendar day. Nothing here says a cover is "valid" or "adequate": no insurer or bond issuer has been asked, so the
// strongest claim is what the register records.
import type { LocalDate } from '@archova/time';

export const INSURANCE_KINDS = [
  'public_liability',
  'workers_comp',
  'contract_works',
  'professional_indemnity',
  'personal_accident',
  'other_insurance',
] as const;
export const BOND_KINDS = [
  'performance_bond',
  'retention_bond',
  'advance_payment_bond',
  'bank_guarantee',
  'other_bond',
] as const;
export const COVER_KINDS = [...INSURANCE_KINDS, ...BOND_KINDS] as const;
export type CoverKind = (typeof COVER_KINDS)[number];
export type CoverCategory = 'insurance' | 'bond';

export const COVER_KIND_LABELS: Record<CoverKind, string> = {
  public_liability: 'Public liability insurance',
  workers_comp: "Workers' compensation insurance",
  contract_works: 'Contract works insurance',
  professional_indemnity: 'Professional indemnity insurance',
  personal_accident: 'Personal accident insurance',
  other_insurance: 'Other insurance',
  performance_bond: 'Performance bond',
  retention_bond: 'Retention bond',
  advance_payment_bond: 'Advance payment bond',
  bank_guarantee: 'Bank guarantee',
  other_bond: 'Other bond',
};

export const coverCategory = (k: CoverKind): CoverCategory =>
  (BOND_KINDS as readonly string[]).includes(k) ? 'bond' : 'insurance';

/** A sensible starting set for a subcontract, offered as a one-tap default. It is never applied silently. */
export const SUGGESTED_REQUIREMENTS: readonly CoverKind[] = [
  'public_liability',
  'workers_comp',
  'contract_works',
];

export const DEFAULT_LEAD_DAYS = 30;

export type Lifecycle = 'active' | 'renewal_in_progress' | 'closed';
export type CoverStatus = 'active' | 'expiring_soon' | 'expired' | 'renewal_in_progress' | 'closed';

export const COVER_ACTIONS = ['startRenewal', 'markRenewed', 'close', 'reopen'] as const;
export type CoverAction = (typeof COVER_ACTIONS)[number];

const DAY_MS = 86_400_000;
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);

/** Whole days from `today` to the expiry; negative once expired. Null when the cover has no expiry (some bonds). */
export function daysToExpiry(expiresOn: string | null, today: LocalDate): number | null {
  return expiresOn ? dayNumber(expiresOn) - dayNumber(today) : null;
}

/** Expired from the day after `expiresOn`. Closed and renewing covers keep those words ahead of the date. */
export function coverStatus(
  c: { lifecycle: Lifecycle; expiresOn: string | null },
  today: LocalDate,
  leadDays = DEFAULT_LEAD_DAYS,
): CoverStatus {
  if (c.lifecycle === 'closed') return 'closed';
  if (c.lifecycle === 'renewal_in_progress') return 'renewal_in_progress';
  const left = daysToExpiry(c.expiresOn, today);
  if (left === null) return 'active';
  if (left < 0) return 'expired';
  return left <= leadDays ? 'expiring_soon' : 'active';
}

export const coverLabel = (n: number) => `INS-${String(n).padStart(4, '0')}`;

export type TransitionResult = { ok: true; to: Lifecycle } | { ok: false; reason: string };

/** startRenewal and markRenewed need an active or renewing cover; markRenewed needs the new expiry date. */
export function coverTransition(
  from: Lifecycle,
  action: CoverAction,
  input: { newExpiresOn?: string | null; currentExpiresOn?: string | null } = {},
): TransitionResult {
  switch (action) {
    case 'startRenewal':
      return from === 'active'
        ? { ok: true, to: 'renewal_in_progress' }
        : { ok: false, reason: 'Only an active cover can start renewal.' };
    case 'markRenewed':
      if (from === 'closed') return { ok: false, reason: 'Reopen the cover before renewing it.' };
      if (!input.newExpiresOn) return { ok: false, reason: 'Give the new expiry date.' };
      if (input.currentExpiresOn && input.newExpiresOn <= input.currentExpiresOn)
        return { ok: false, reason: 'The new expiry date must be after the current one.' };
      return { ok: true, to: 'active' };
    case 'close':
      return from === 'closed'
        ? { ok: false, reason: 'The cover is already closed.' }
        : { ok: true, to: 'closed' };
    case 'reopen':
      return from === 'closed'
        ? { ok: true, to: 'active' }
        : { ok: false, reason: 'Only a closed cover can be reopened.' };
  }
}

export interface Requirement {
  kind: CoverKind;
  leadDays: number;
  minAmountCents: number | null;
}

interface RuleCover {
  id: string;
  number: number;
  companyId: string;
  kind: CoverKind;
  title: string;
  lifecycle: Lifecycle;
  expiresOn: string | null;
  amountCents: number | null;
}

export type IssueKind =
  'expired' | 'expired_while_renewing' | 'expiring' | 'missing' | 'below_minimum';

export interface CompanyIssue {
  kind: IssueKind;
  /** `blocking` stops the company at the gate; `warning` is shown but does not block. */
  level: 'blocking' | 'warning';
  coverId: string | null;
  coverKind: CoverKind | null;
  coverLabel: string | null;
  expiresOn: string | null;
  daysLeft: number | null;
  message: string;
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
const inDays = (n: number) => (n === 0 ? 'today' : `in ${n} day${n === 1 ? '' : 's'}`);

/**
 * What is wrong with one company's cover today. A required kind is "missing" when the company has no open cover of
 * that kind; one that is expired (even while a renewal is in progress) does not satisfy it, and a company with a
 * current cover plus an old expired one is judged on the current one. Missing and expired block; expiring and below
 * the minimum amount warn. `windowDays` is the warning period for kinds with no requirement.
 */
export function companyIssues(input: {
  covers: readonly RuleCover[];
  requirements: readonly Requirement[];
  today: LocalDate;
  windowDays?: number;
}): CompanyIssue[] {
  const lead = new Map(input.requirements.map((r) => [r.kind, r.leadDays]));
  const window = input.windowDays ?? DEFAULT_LEAD_DAYS;
  const out: CompanyIssue[] = [];
  const open = input.covers.filter((c) => c.lifecycle !== 'closed');
  const isLive = (c: RuleCover) => {
    const left = daysToExpiry(c.expiresOn, input.today);
    return left === null || left >= 0;
  };
  for (const c of open) {
    const left = daysToExpiry(c.expiresOn, input.today);
    if (left === null) continue;
    const name = `${coverLabel(c.number)} ${COVER_KIND_LABELS[c.kind].toLowerCase()}`;
    // A live cover of the same kind makes an older expired one history, not a problem.
    const replaced = left < 0 && open.some((o) => o.id !== c.id && o.kind === c.kind && isLive(o));
    if (replaced) continue;
    if (left < 0)
      out.push({
        kind: c.lifecycle === 'renewal_in_progress' ? 'expired_while_renewing' : 'expired',
        level: 'blocking',
        coverId: c.id,
        coverKind: c.kind,
        coverLabel: coverLabel(c.number),
        expiresOn: c.expiresOn,
        daysLeft: left,
        message: `${name} expired ${-left} day${left === -1 ? '' : 's'} ago${c.lifecycle === 'renewal_in_progress' ? '; renewal is in progress' : ''}.`,
      });
    else if (c.lifecycle === 'active' && left <= (lead.get(c.kind) ?? window))
      out.push({
        kind: 'expiring',
        level: 'warning',
        coverId: c.id,
        coverKind: c.kind,
        coverLabel: coverLabel(c.number),
        expiresOn: c.expiresOn,
        daysLeft: left,
        message: `${name} expires ${inDays(left)}.`,
      });
  }
  for (const r of input.requirements) {
    const ofKind = open.filter((c) => c.kind === r.kind);
    if (ofKind.length === 0) {
      out.push({
        kind: 'missing',
        level: 'blocking',
        coverId: null,
        coverKind: r.kind,
        coverLabel: null,
        expiresOn: null,
        daysLeft: null,
        message: `No ${COVER_KIND_LABELS[r.kind].toLowerCase()} on the register.`,
      });
      continue;
    }
    if (r.minAmountCents === null) continue;
    // An amount nobody typed in is unknown, not zero: only compare the ones that are recorded.
    const known = ofKind
      .filter(isLive)
      .flatMap((c) => (c.amountCents === null ? [] : [c.amountCents]));
    const best = known.length > 0 ? Math.max(...known) : null;
    if (best !== null && best < r.minAmountCents)
      out.push({
        kind: 'below_minimum',
        level: 'warning',
        coverId: null,
        coverKind: r.kind,
        coverLabel: null,
        expiresOn: null,
        daysLeft: null,
        message: `${COVER_KIND_LABELS[r.kind]} is ${money(best)}; this project asks for at least ${money(r.minAmountCents)}.`,
      });
  }
  return out;
}

export type GateState = 'cleared' | 'warning' | 'blocked';
export const gateState = (issues: readonly CompanyIssue[]): GateState =>
  issues.some((i) => i.level === 'blocking')
    ? 'blocked'
    : issues.length > 0
      ? 'warning'
      : 'cleared';

// ---- Nova flags (rule-based, no model) ----

export interface CoverFlag {
  kind: IssueKind;
  severity: 'info' | 'warn' | 'high';
  companyId: string;
  title: string;
  detail: string;
  coverId: string | null;
  coverKind: CoverKind | null;
  expiresOn: string | null;
  daysLeft: number | null;
}

const DETAIL: Record<IssueKind, string> = {
  expired:
    'Cover has lapsed. The company is blocked at the site gate until a current one is recorded.',
  expired_while_renewing:
    'Renewal is in progress but the date has passed. Ask for the new certificate before work continues.',
  expiring: 'Ask the company for the renewed certificate or bond before it lapses.',
  missing: 'This project expects it. Add it, or remove the requirement if it does not apply.',
  below_minimum: 'Check the amount against the subcontract, or ask for a higher limit.',
};

/**
 * What needs a person's attention on a project today, across the companies being tracked (those with at least one
 * cover on the register). Sorted most urgent first.
 */
export function coverFlags(input: {
  covers: readonly (RuleCover & { companyName: string })[];
  requirements: readonly Requirement[];
  today: LocalDate;
  windowDays?: number;
}): CoverFlag[] {
  const names = new Map(input.covers.map((c) => [c.companyId, c.companyName]));
  const out: CoverFlag[] = [];
  for (const [companyId, companyName] of names) {
    const issues = companyIssues({
      covers: input.covers.filter((c) => c.companyId === companyId),
      requirements: input.requirements,
      today: input.today,
      ...(input.windowDays ? { windowDays: input.windowDays } : {}),
    });
    for (const i of issues)
      out.push({
        kind: i.kind,
        severity:
          i.level === 'blocking'
            ? 'high'
            : i.kind === 'expiring' && (i.daysLeft ?? 99) <= 7
              ? 'high'
              : 'warn',
        companyId,
        title: `${companyName}: ${i.message}`,
        detail: DETAIL[i.kind],
        coverId: i.coverId,
        coverKind: i.coverKind,
        expiresOn: i.expiresOn,
        daysLeft: i.daysLeft,
      });
  }
  const rank = { high: 0, warn: 1, info: 2 } as const;
  return out.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999),
  );
}
