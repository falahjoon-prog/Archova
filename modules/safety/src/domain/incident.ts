// Incident rules (compliance 03 §7, WHS Act s35-s39). Pure, no IO. Archova records the classification and the
// regulator timings; the builder notifies the regulator themselves.

export const INCIDENT_TYPES = [
  'injury',
  'near_miss',
  'property_damage',
  'environmental',
  'dangerous_occurrence',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const NOTIFIABLE_CLASSES = [
  'death',
  'serious_injury_illness',
  'dangerous_incident',
] as const;
export type NotifiableClass = (typeof NOTIFIABLE_CLASSES)[number];

export type IncidentStatus = 'reported' | 'investigating' | 'closed';
export type IncidentAction = 'investigate' | 'close' | 'reopen';
export type CorrectiveStatus = 'open' | 'done' | 'verified';

export interface RootCause {
  method: 'five_whys' | 'fishbone' | 'other';
  /** The underlying causes found, one per entry. */
  causes: string[];
  summary: string;
}

/** Written notice is due 48 hours after the regulator asks for it (s38(4)). Null until it is asked for. */
export function writtenNoticeDueAt(requestedAt: Date | null): Date | null {
  return requestedAt ? new Date(requestedAt.getTime() + 48 * 3_600_000) : null;
}

/** The record is kept at least 5 years from notification (s38(7)); null until the regulator is notified. */
export function keepUntil(notifiedAt: Date | null): Date | null {
  if (!notifiedAt) return null;
  const d = new Date(notifiedAt);
  d.setUTCFullYear(d.getUTCFullYear() + 5);
  return d;
}

export type NotifiableCheck = { ok: true } | { ok: false; message: string; field: string };

/** A notifiable incident needs its class; a class without the flag is a contradiction. */
export function checkNotifiable(
  isNotifiable: boolean,
  cls: NotifiableClass | null,
): NotifiableCheck {
  if (isNotifiable && !cls)
    return { ok: false, field: 'notifiableClass', message: 'Choose the notifiable class.' };
  if (!isNotifiable && cls)
    return { ok: false, field: 'isNotifiable', message: 'A notifiable class needs isNotifiable.' };
  return { ok: true };
}

export type TransitionResult =
  | { ok: true; to: IncidentStatus }
  | { ok: false; code: 'incident.invalid_transition' | 'incident.reason_required' };

export function incidentTransition(
  from: IncidentStatus,
  action: IncidentAction,
  reason: string | null,
): TransitionResult {
  if (action === 'investigate' && from === 'reported') return { ok: true, to: 'investigating' };
  if (action === 'close' && from === 'investigating') return { ok: true, to: 'closed' };
  if (action === 'reopen' && from === 'closed') {
    return reason?.trim()
      ? { ok: true, to: 'investigating' }
      : { ok: false, code: 'incident.reason_required' };
  }
  return { ok: false, code: 'incident.invalid_transition' };
}

export interface CloseBlocker {
  field: string;
  message: string;
}

/** What must be true before an incident closes: a root cause, a regulator timestamp when notifiable, and every
 *  corrective action verified. */
export function closeBlockers(i: {
  isNotifiable: boolean;
  regulatorNotifiedAt: Date | null;
  rootCause: RootCause | null;
  actions: { status: CorrectiveStatus }[];
}): CloseBlocker[] {
  const out: CloseBlocker[] = [];
  if (!i.rootCause || i.rootCause.causes.every((c) => !c.trim()) || !i.rootCause.summary.trim())
    out.push({ field: 'rootCause', message: 'Record the root cause before closing.' });
  if (i.isNotifiable && !i.regulatorNotifiedAt)
    out.push({
      field: 'regulatorNotifiedAt',
      message: 'Record when the regulator was notified.',
    });
  const open = i.actions.filter((a) => a.status !== 'verified').length;
  if (open > 0)
    out.push({
      field: 'actions',
      message: `${open} corrective ${open === 1 ? 'action is' : 'actions are'} not verified.`,
    });
  return out;
}

export function correctiveTransition(from: CorrectiveStatus, to: CorrectiveStatus): boolean {
  return (
    (from === 'open' && to === 'done') || (from === 'done' && (to === 'verified' || to === 'open'))
  );
}

export const isOverdue = (dueDate: string | null, status: CorrectiveStatus, localToday: string) =>
  status !== 'verified' && dueDate !== null && dueDate < localToday;

export const incidentLabel = (n: number) => `INC-${String(n).padStart(4, '0')}`;
