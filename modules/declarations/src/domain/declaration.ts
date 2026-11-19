// Subcontractor statutory declarations: the rules, with no I/O. A builder collects a workers' compensation, payroll tax
// and wages declaration from each subcontractor with every payment claim. Archova records what was received and the
// period it covers; nothing here says a declaration is "true" or "valid in law": no insurer or revenue office has been
// asked, so the strongest claim is what the register records.
import type { LocalDate } from '@archova/time';

export const DECLARATION_KINDS = ['workers_comp', 'payroll_tax', 'wages'] as const;
export type DeclarationKind = (typeof DECLARATION_KINDS)[number];

export const DECLARATION_LABELS: Record<DeclarationKind, string> = {
  workers_comp: "Workers' compensation (WorkCover) declaration",
  payroll_tax: 'Payroll tax declaration',
  wages: 'Wages and superannuation declaration',
};

/** Default days before a declaration's end date at which it is flagged as running out. */
export const DEFAULT_LEAD_DAYS: Record<DeclarationKind, number> = {
  workers_comp: 30,
  payroll_tax: 14,
  wages: 7,
};

/** A one-tap starting set. It is never applied silently. */
export const SUGGESTED_REQUIREMENTS: readonly DeclarationKind[] = [...DECLARATION_KINDS];

export type Lifecycle = 'accepted' | 'rejected';
export type DeclarationStatus =
  'current' | 'expiring_soon' | 'expired' | 'not_yet_valid' | 'rejected';

export const DECLARATION_ACTIONS = ['reject', 'accept'] as const;
export type DeclarationAction = (typeof DECLARATION_ACTIONS)[number];

const DAY_MS = 86_400_000;
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

/** Whole days from `today` to the end date; negative once it has passed. */
export const daysToEnd = (validTo: string, today: LocalDate) => daysBetween(today, validTo);

export function declarationStatus(
  d: { lifecycle: Lifecycle; validFrom: string; validTo: string },
  today: LocalDate,
  leadDays: number,
): DeclarationStatus {
  if (d.lifecycle === 'rejected') return 'rejected';
  if (today < d.validFrom) return 'not_yet_valid';
  const left = daysToEnd(d.validTo, today);
  if (left < 0) return 'expired';
  return left <= leadDays ? 'expiring_soon' : 'current';
}

export const declarationLabel = (n: number) => `DEC-${String(n).padStart(4, '0')}`;

export type TransitionResult = { ok: true; to: Lifecycle } | { ok: false; reason: string };

export function declarationTransition(
  from: Lifecycle,
  action: DeclarationAction,
): TransitionResult {
  switch (action) {
    case 'reject':
      return from === 'accepted'
        ? { ok: true, to: 'rejected' }
        : { ok: false, reason: 'The declaration is already rejected.' };
    case 'accept':
      return from === 'rejected'
        ? { ok: true, to: 'accepted' }
        : { ok: false, reason: 'The declaration is already accepted.' };
  }
}

export interface Requirement {
  kind: DeclarationKind;
  leadDays: number;
}

export interface RuleDeclaration {
  id: string;
  number: number;
  companyId: string;
  kind: DeclarationKind;
  lifecycle: Lifecycle;
  validFrom: string;
  validTo: string;
  claimId: string | null;
}

export type IssueKind = 'missing' | 'rejected' | 'does_not_cover' | 'expired' | 'expiring';

export interface DeclarationIssue {
  kind: IssueKind;
  /** `blocking` stops a claim being scheduled for payment; `warning` is shown but does not block. */
  level: 'blocking' | 'warning';
  declarationKind: DeclarationKind;
  declarationId: string | null;
  declarationLabel: string | null;
  validTo: string | null;
  daysLeft: number | null;
  message: string;
}

const shortDate = (d: string) => {
  const [y, m, day] = d.split('-');
  const month = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ][Number(m) - 1];
  return `${Number(day)} ${month} ${y}`;
};
const inDays = (n: number) => (n === 0 ? 'today' : `in ${n} day${n === 1 ? '' : 's'}`);

/** A declaration counts for a claim when it was given for that claim, or its dates cover the claim's period end. */
export const covers = (d: RuleDeclaration, claim: { id: string | null; periodEnd: string }) =>
  d.lifecycle === 'accepted' &&
  ((claim.id !== null && d.claimId === claim.id) ||
    (d.claimId === null && d.validFrom <= claim.periodEnd && claim.periodEnd <= d.validTo));

/**
 * What stops one company's claim being paid: for every required kind, an accepted declaration whose dates cover the
 * claim's period end (or that was given for this claim). Missing, rejected and out-of-date ones block. A project that
 * sets no requirements never blocks anyone.
 */
export function claimIssues(input: {
  declarations: readonly RuleDeclaration[];
  requirements: readonly Requirement[];
  claim: { id: string | null; periodEnd: string };
}): DeclarationIssue[] {
  const out: DeclarationIssue[] = [];
  for (const r of input.requirements) {
    // One given for another claim says nothing about this one.
    const ofKind = input.declarations.filter(
      (d) => d.kind === r.kind && (d.claimId === null || d.claimId === input.claim.id),
    );
    if (ofKind.some((d) => covers(d, input.claim))) continue;
    const name = DECLARATION_LABELS[r.kind];
    const accepted = ofKind.filter((d) => d.lifecycle === 'accepted');
    if (accepted.length > 0) {
      // The one that runs furthest is the nearest miss; say how it falls short.
      const best = [...accepted].sort((a, b) => (a.validTo < b.validTo ? 1 : -1))[0]!;
      const early = input.claim.periodEnd < best.validFrom;
      out.push({
        kind: early ? 'does_not_cover' : 'expired',
        level: 'blocking',
        declarationKind: r.kind,
        declarationId: best.id,
        declarationLabel: declarationLabel(best.number),
        validTo: best.validTo,
        daysLeft: null,
        message: early
          ? `${declarationLabel(best.number)} starts on ${shortDate(best.validFrom)}, after this claim's period ends on ${shortDate(input.claim.periodEnd)}.`
          : `${declarationLabel(best.number)} ran to ${shortDate(best.validTo)} and does not cover this claim's period ending ${shortDate(input.claim.periodEnd)}.`,
      });
      continue;
    }
    if (ofKind.length > 0) {
      const last = ofKind[0]!;
      out.push({
        kind: 'rejected',
        level: 'blocking',
        declarationKind: r.kind,
        declarationId: last.id,
        declarationLabel: declarationLabel(last.number),
        validTo: last.validTo,
        daysLeft: null,
        message: `${declarationLabel(last.number)} was rejected; ask for a corrected ${name.toLowerCase()}.`,
      });
      continue;
    }
    out.push({
      kind: 'missing',
      level: 'blocking',
      declarationKind: r.kind,
      declarationId: null,
      declarationLabel: null,
      validTo: null,
      daysLeft: null,
      message: `No ${name.toLowerCase()} received.`,
    });
  }
  return out;
}

/**
 * What needs attention on one company's register today, independent of any claim: required kinds with nothing current
 * (missing, rejected or lapsed) and declarations about to run out. A company with a current declaration of a kind is
 * judged on that one; older ones are history.
 */
export function standingIssues(input: {
  declarations: readonly RuleDeclaration[];
  requirements: readonly Requirement[];
  today: LocalDate;
}): DeclarationIssue[] {
  const lead = new Map(input.requirements.map((r) => [r.kind, r.leadDays]));
  const out: DeclarationIssue[] = [];
  const kinds = new Set<DeclarationKind>([
    ...input.requirements.map((r) => r.kind),
    ...input.declarations.map((d) => d.kind),
  ]);
  for (const kind of kinds) {
    const required = lead.has(kind);
    const ofKind = input.declarations.filter((d) => d.kind === kind);
    const live = ofKind.filter(
      (d) => d.lifecycle === 'accepted' && d.validFrom <= input.today && d.validTo >= input.today,
    );
    if (live.length > 0) {
      const best = [...live].sort((a, b) => (a.validTo < b.validTo ? 1 : -1))[0]!;
      const left = daysToEnd(best.validTo, input.today);
      if (left <= (lead.get(kind) ?? DEFAULT_LEAD_DAYS[kind]))
        out.push({
          kind: 'expiring',
          level: 'warning',
          declarationKind: kind,
          declarationId: best.id,
          declarationLabel: declarationLabel(best.number),
          validTo: best.validTo,
          daysLeft: left,
          message: `${declarationLabel(best.number)} ${DECLARATION_LABELS[kind].toLowerCase()} runs out ${inDays(left)}.`,
        });
      continue;
    }
    if (!required) continue;
    const accepted = ofKind.filter((d) => d.lifecycle === 'accepted');
    if (accepted.length > 0) {
      const best = [...accepted].sort((a, b) => (a.validTo < b.validTo ? 1 : -1))[0]!;
      out.push({
        kind: 'expired',
        level: 'blocking',
        declarationKind: kind,
        declarationId: best.id,
        declarationLabel: declarationLabel(best.number),
        validTo: best.validTo,
        daysLeft: daysToEnd(best.validTo, input.today),
        message: `${declarationLabel(best.number)} ${DECLARATION_LABELS[kind].toLowerCase()} is not current (${shortDate(best.validFrom)} to ${shortDate(best.validTo)}).`,
      });
    } else if (ofKind.length > 0) {
      const last = ofKind[0]!;
      out.push({
        kind: 'rejected',
        level: 'blocking',
        declarationKind: kind,
        declarationId: last.id,
        declarationLabel: declarationLabel(last.number),
        validTo: last.validTo,
        daysLeft: null,
        message: `${declarationLabel(last.number)} was rejected and nothing replaces it.`,
      });
    } else {
      out.push({
        kind: 'missing',
        level: 'blocking',
        declarationKind: kind,
        declarationId: null,
        declarationLabel: null,
        validTo: null,
        daysLeft: null,
        message: `No ${DECLARATION_LABELS[kind].toLowerCase()} on the register.`,
      });
    }
  }
  return out;
}

export type GateState = 'cleared' | 'warning' | 'blocked';
export const gateState = (issues: readonly DeclarationIssue[]): GateState =>
  issues.some((i) => i.level === 'blocking')
    ? 'blocked'
    : issues.length > 0
      ? 'warning'
      : 'cleared';

// ---- Nova flags (rule-based, no model) ----

export interface DeclarationFlag {
  kind: IssueKind;
  severity: 'info' | 'warn' | 'high';
  companyId: string;
  title: string;
  detail: string;
  declarationId: string | null;
  declarationKind: DeclarationKind;
  validTo: string | null;
  daysLeft: number | null;
}

const DETAIL: Record<IssueKind, string> = {
  missing:
    'This project asks for it with every claim. Ask the subcontractor for it before their next claim is paid.',
  rejected: 'The declaration received was rejected. Ask for a corrected one.',
  does_not_cover: 'The declaration starts after the period being claimed.',
  expired: 'The period it covers has ended. Ask for a current one before the next claim is paid.',
  expiring: 'Ask the subcontractor for the next declaration before it runs out.',
};

/** What needs a person's attention across the companies on the register, most urgent first. */
export function declarationFlags(input: {
  declarations: readonly (RuleDeclaration & { companyName: string })[];
  requirements: readonly Requirement[];
  today: LocalDate;
}): DeclarationFlag[] {
  const names = new Map(input.declarations.map((d) => [d.companyId, d.companyName]));
  const out: DeclarationFlag[] = [];
  for (const [companyId, companyName] of names) {
    const issues = standingIssues({
      declarations: input.declarations.filter((d) => d.companyId === companyId),
      requirements: input.requirements,
      today: input.today,
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
        declarationId: i.declarationId,
        declarationKind: i.declarationKind,
        validTo: i.validTo,
        daysLeft: i.daysLeft,
      });
  }
  const rank = { high: 0, warn: 1, info: 2 } as const;
  return out.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999),
  );
}

// ---- Chasing a subcontractor (a drafted email: no model, a person sends it) ----

export interface ChaseDraft {
  subject: string;
  body: string;
  kinds: DeclarationKind[];
}

/**
 * The email Nova drafts for a subcontractor missing declarations. Plain words, one line per missing item. It asks; it
 * never says a claim will be held, reduced or not paid, because whether a principal may withhold for a missing
 * declaration is a question for a lawyer (compliance/05 §6) and a payment schedule must still be issued on time.
 */
export function draftChase(input: {
  companyName: string;
  projectName: string;
  senderName: string;
  claim: { number: number; periodEnd: string } | null;
  issues: readonly DeclarationIssue[];
}): ChaseDraft | null {
  const blocking = input.issues.filter((i) => i.level === 'blocking');
  const chasing = blocking.length > 0 ? blocking : input.issues;
  if (chasing.length === 0) return null;
  const kinds = [...new Set(chasing.map((i) => i.declarationKind))];
  const lines = chasing.map((i) => {
    const name = DECLARATION_LABELS[i.declarationKind];
    const what =
      i.kind === 'missing'
        ? 'not yet received'
        : i.kind === 'rejected'
          ? 'needs to be reissued'
          : i.kind === 'expiring'
            ? `runs out on ${i.validTo ? shortDate(i.validTo) : 'soon'}`
            : `needs to cover the period ending ${input.claim ? shortDate(input.claim.periodEnd) : 'now'}`;
    return `- ${name}: ${what}`;
  });
  const claim = input.claim
    ? `payment claim ${input.claim.number} (period ending ${shortDate(input.claim.periodEnd)})`
    : 'your payment claims';
  return {
    subject: `${input.projectName}: declarations needed for ${input.claim ? `payment claim ${input.claim.number}` : 'your next claim'}`,
    kinds,
    body: [
      `Hi ${input.companyName},`,
      '',
      `To complete our records for ${claim} on ${input.projectName}, we still need:`,
      '',
      ...lines,
      '',
      'Please reply to this email with the signed declarations attached (PDF), or send them through your usual contact on the project.',
      '',
      'Thank you,',
      input.senderName,
    ].join('\n'),
  };
}
