// Permits and approvals register: the rules, with no I/O. Status words are derived from the expiry date and the
// project's own calendar day; nothing here says a permit is "valid" or "compliant", only what the register records.
import type { LocalDate } from '@archova/time';

export const PERMIT_KINDS = [
  'building_permit',
  'development_approval',
  'construction_certificate',
  'occupation_certificate',
  'council_approval',
  'planning_permit',
  'environmental_permit',
  'road_occupancy',
  'traffic_management',
  'crane_hoist',
  'demolition',
  'hot_work',
  'trade_licence',
  'other',
] as const;
export type PermitKind = (typeof PERMIT_KINDS)[number];

export const PERMIT_KIND_LABELS: Record<PermitKind, string> = {
  building_permit: 'Building permit',
  development_approval: 'Development approval',
  construction_certificate: 'Construction certificate',
  occupation_certificate: 'Occupation certificate',
  council_approval: 'Council approval',
  planning_permit: 'Planning permit',
  environmental_permit: 'Environmental permit',
  road_occupancy: 'Road occupancy permit',
  traffic_management: 'Traffic management approval',
  crane_hoist: 'Crane or hoist permit',
  demolition: 'Demolition permit',
  hot_work: 'Hot work permit',
  trade_licence: 'Trade licence',
  other: 'Other',
};

/** A sensible starting set for a new build, offered as a one-tap default. It is never applied silently. */
export const SUGGESTED_REQUIREMENTS: readonly PermitKind[] = [
  'development_approval',
  'building_permit',
  'construction_certificate',
  'occupation_certificate',
];

export const DEFAULT_LEAD_DAYS = 30;

export type Lifecycle = 'active' | 'renewal_in_progress' | 'closed';
export type PermitStatus =
  'active' | 'expiring_soon' | 'expired' | 'renewal_in_progress' | 'closed';

export const PERMIT_ACTIONS = ['startRenewal', 'markRenewed', 'close', 'reopen'] as const;
export type PermitAction = (typeof PERMIT_ACTIONS)[number];

const DAY_MS = 86_400_000;
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);

/** Whole days from `today` to the expiry; negative once expired. Null when the permit has no expiry. */
export function daysToExpiry(expiresOn: string | null, today: LocalDate): number | null {
  return expiresOn ? dayNumber(expiresOn) - dayNumber(today) : null;
}

/** Expired from the day after `expiresOn`. Closed and renewing permits keep those words ahead of the date. */
export function permitStatus(
  p: { lifecycle: Lifecycle; expiresOn: string | null },
  today: LocalDate,
  leadDays = DEFAULT_LEAD_DAYS,
): PermitStatus {
  if (p.lifecycle === 'closed') return 'closed';
  if (p.lifecycle === 'renewal_in_progress') return 'renewal_in_progress';
  const left = daysToExpiry(p.expiresOn, today);
  if (left === null) return 'active';
  if (left < 0) return 'expired';
  return left <= leadDays ? 'expiring_soon' : 'active';
}

export const permitLabel = (n: number) => `PMT-${String(n).padStart(4, '0')}`;

export type TransitionResult = { ok: true; to: Lifecycle } | { ok: false; reason: string };

/** startRenewal and markRenewed need an active or renewing permit; markRenewed needs the new expiry date. */
export function permitTransition(
  from: Lifecycle,
  action: PermitAction,
  input: { newExpiresOn?: string | null; currentExpiresOn?: string | null } = {},
): TransitionResult {
  switch (action) {
    case 'startRenewal':
      return from === 'active'
        ? { ok: true, to: 'renewal_in_progress' }
        : { ok: false, reason: 'Only an active permit can start renewal.' };
    case 'markRenewed':
      if (from === 'closed') return { ok: false, reason: 'Reopen the permit before renewing it.' };
      if (!input.newExpiresOn) return { ok: false, reason: 'Give the new expiry date.' };
      if (input.currentExpiresOn && input.newExpiresOn <= input.currentExpiresOn)
        return { ok: false, reason: 'The new expiry date must be after the current one.' };
      return { ok: true, to: 'active' };
    case 'close':
      return from === 'closed'
        ? { ok: false, reason: 'The permit is already closed.' }
        : { ok: true, to: 'closed' };
    case 'reopen':
      return from === 'closed'
        ? { ok: true, to: 'active' }
        : { ok: false, reason: 'Only a closed permit can be reopened.' };
  }
}

// ---- Nova flags (rule-based, no model) ----

export type PermitFlagKind =
  'expiring' | 'expired' | 'expired_while_renewing' | 'missing_required' | 'worker_licence_lapsed';

export interface PermitFlag {
  kind: PermitFlagKind;
  severity: 'info' | 'warn' | 'high';
  title: string;
  detail: string;
  permitId: string | null;
  permitKind: PermitKind | null;
  expiresOn: string | null;
  daysLeft: number | null;
}

interface FlagPermit {
  id: string;
  number: number;
  kind: PermitKind;
  title: string;
  lifecycle: Lifecycle;
  expiresOn: string | null;
}

export interface Requirement {
  kind: PermitKind;
  leadDays: number;
}

export interface LapsedLicence {
  title: string;
  holder: string | null;
  itemType: string;
  expiresOn: string;
  state: 'expired' | 'expiring';
}

/**
 * What needs a person's attention on a project today. A required kind is "missing" only when no open permit of that
 * kind is on the register; a closed permit does not count. Expiring uses the kind's own lead days if it has a
 * requirement, else `windowDays`.
 */
export function permitFlags(input: {
  permits: readonly FlagPermit[];
  requirements: readonly Requirement[];
  lapsed: readonly LapsedLicence[];
  today: LocalDate;
  windowDays?: number;
}): PermitFlag[] {
  const lead = new Map(input.requirements.map((r) => [r.kind, r.leadDays]));
  const window = input.windowDays ?? DEFAULT_LEAD_DAYS;
  const out: PermitFlag[] = [];
  for (const p of input.permits) {
    if (p.lifecycle === 'closed') continue;
    const left = daysToExpiry(p.expiresOn, input.today);
    if (left === null) continue;
    const name = `${permitLabel(p.number)} ${p.title}`;
    if (left < 0) {
      out.push({
        kind: p.lifecycle === 'renewal_in_progress' ? 'expired_while_renewing' : 'expired',
        severity: 'high',
        title: `${name} expired ${-left} day${left === -1 ? '' : 's'} ago`,
        detail:
          p.lifecycle === 'renewal_in_progress'
            ? 'Renewal is in progress but the permit has passed its expiry date. Confirm the work it covers may continue.'
            : 'Work that depends on this permit may need to stop until it is renewed.',
        permitId: p.id,
        permitKind: p.kind,
        expiresOn: p.expiresOn,
        daysLeft: left,
      });
    } else if (p.lifecycle === 'active' && left <= (lead.get(p.kind) ?? window)) {
      out.push({
        kind: 'expiring',
        severity: left <= 7 ? 'high' : 'warn',
        title: `${name} expires ${left === 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`}`,
        detail: 'Start the renewal so the permit does not lapse.',
        permitId: p.id,
        permitKind: p.kind,
        expiresOn: p.expiresOn,
        daysLeft: left,
      });
    }
  }
  const held = new Set(input.permits.filter((p) => p.lifecycle !== 'closed').map((p) => p.kind));
  for (const r of input.requirements) {
    if (held.has(r.kind)) continue;
    out.push({
      kind: 'missing_required',
      severity: 'warn',
      title: `No ${PERMIT_KIND_LABELS[r.kind].toLowerCase()} on the register`,
      detail:
        'This project is set to expect one. Add it, or remove the requirement if it does not apply.',
      permitId: null,
      permitKind: r.kind,
      expiresOn: null,
      daysLeft: null,
    });
  }
  for (const l of input.lapsed)
    out.push({
      kind: 'worker_licence_lapsed',
      severity: l.state === 'expired' ? 'high' : 'warn',
      title: `${l.holder ? `${l.holder}: ` : ''}${l.title} ${l.state === 'expired' ? 'has expired' : 'is about to expire'}`,
      detail: `Recorded in the compliance wallet, expiry ${l.expiresOn}. Archova has not checked this against a licensing register.`,
      permitId: null,
      permitKind: null,
      expiresOn: l.expiresOn,
      daysLeft: null,
    });
  const rank = { high: 0, warn: 1, info: 2 } as const;
  return out.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999),
  );
}
