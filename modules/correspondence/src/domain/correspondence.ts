// Correspondence lifecycle and time-bar rules (product/08 SCH-AC4/AC5, product/03). Pure rules, no IO.
//   draft → sent → responded → closed, with `void` from draft (or from a sent item that is not evidential).
// An evidential item is frozen when it is sent: nothing on it changes, and it can only be answered or closed.
import { addBusinessDays, addDays, type LocalDate } from '@archova/time';

export const CORRESPONDENCE_STATUSES = ['draft', 'sent', 'responded', 'closed', 'void'] as const;
export type CorrespondenceStatus = (typeof CORRESPONDENCE_STATUSES)[number];

export const RELATED_KINDS = [
  'rfi',
  'submittal',
  'correspondence',
  'variation',
  'diary',
  'other',
] as const;
export type RelatedKind = (typeof RELATED_KINDS)[number];
export interface RelatedLink {
  kind: RelatedKind;
  id: string;
  label?: string;
}

export const canEditItem = (s: CorrespondenceStatus) => s === 'draft';
export const canSend = (s: CorrespondenceStatus) => s === 'draft';
export const canRespond = (s: CorrespondenceStatus) => s === 'sent' || s === 'responded';
export const canClose = (s: CorrespondenceStatus) => s === 'sent' || s === 'responded';
/** Evidential items are never voided once sent; they are answered or closed. */
export const canVoid = (s: CorrespondenceStatus, isEvidential: boolean) =>
  s === 'draft' || ((s === 'sent' || s === 'responded') && !isEvidential);

/** The day a notice must be given by: the event plus the contract's notice period, in calendar days. */
export function timeBarDate(eventDate: string | null, days: number | null): string | null {
  if (!eventDate || !days) return null;
  return addDays(eventDate as LocalDate, days);
}

export type TimeBarState = 'none' | 'ok' | 'amber' | 'red' | 'overdue';

/**
 * SCH-AC4: a chip that warns at 3 business days and turns red at 1, then shows overdue after the date. Only a
 * draft is still racing the bar; once sent, the notice was given (on time or not) and the chip stops.
 */
export function timeBarState(
  i: { status: CorrespondenceStatus; timeBarDate: string | null },
  today: string,
): TimeBarState {
  if (!i.timeBarDate) return 'none';
  if (i.status !== 'draft') return 'none';
  if (today > i.timeBarDate) return 'overdue';
  if (today >= addBusinessDays(i.timeBarDate as LocalDate, -1)) return 'red';
  if (today >= addBusinessDays(i.timeBarDate as LocalDate, -3)) return 'amber';
  return 'ok';
}

/** Whether a sent notice beat its time bar; null when there was no bar or it is not sent yet. */
export function sentInTime(i: {
  sentLocalDate: string | null;
  timeBarDate: string | null;
}): boolean | null {
  if (!i.timeBarDate || !i.sentLocalDate) return null;
  return i.sentLocalDate <= i.timeBarDate;
}

export function dueDateFor(sentLocalDate: string, responseDays: number): string {
  return addBusinessDays(sentLocalDate as LocalDate, responseDays);
}

export const FIELD_KINDS = ['text', 'date', 'number', 'yesNo'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
/** An extra field a type asks for, such as a Construction Start Date. */
export interface FieldDefinition {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
}
export type FieldValue = string | number | boolean | null;
export type FieldValues = Record<string, FieldValue>;
export interface HistoryChange {
  field: string;
  from: unknown;
  to: unknown;
}

export const MAX_TYPE_FIELDS = 12;
const FIELD_KEY = /^[a-z][a-zA-Z0-9]{0,29}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with a type's field list, as validation details; empty when it is fine. */
export function checkFieldDefinitions(defs: readonly FieldDefinition[]) {
  const problems: Array<{ path: string; message: string }> = [];
  if (defs.length > MAX_TYPE_FIELDS)
    problems.push({ path: 'fields', message: `At most ${MAX_TYPE_FIELDS} fields` });
  const seen = new Set<string>();
  defs.forEach((d, i) => {
    if (!FIELD_KEY.test(d.key))
      problems.push({
        path: `fields/${i}/key`,
        message: 'Start with a lower-case letter; letters and digits only',
      });
    if (seen.has(d.key)) problems.push({ path: `fields/${i}/key`, message: 'Already used' });
    seen.add(d.key);
    if (!d.label.trim() || d.label.length > 60)
      problems.push({ path: `fields/${i}/label`, message: 'Give a label of up to 60 characters' });
    if (!FIELD_KINDS.includes(d.kind))
      problems.push({ path: `fields/${i}/kind`, message: 'Unknown kind' });
  });
  return problems;
}

const validDate = (v: string) => {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
};

/**
 * Checks `values` against the type's fields: only known keys, the right kind of value, null clears. With
 * `forSend` the required ones must be filled. Returns the values to keep and any problems.
 */
export function checkFieldValues(
  defs: readonly FieldDefinition[],
  values: Record<string, unknown>,
  opts: { forSend: boolean },
) {
  const problems: Array<{ path: string; message: string }> = [];
  const out: FieldValues = {};
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const [key, value] of Object.entries(values)) {
    const d = byKey.get(key);
    if (!d) {
      problems.push({ path: `fieldValues/${key}`, message: 'Not a field of this type' });
      continue;
    }
    if (value === null || value === undefined || value === '') continue;
    const ok =
      (d.kind === 'text' && typeof value === 'string' && value.length <= 1000) ||
      (d.kind === 'date' && typeof value === 'string' && validDate(value)) ||
      (d.kind === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
      (d.kind === 'yesNo' && typeof value === 'boolean');
    if (!ok) {
      problems.push({ path: `fieldValues/${key}`, message: `Expected ${d.kind}` });
      continue;
    }
    out[key] = value as FieldValue;
  }
  if (opts.forSend)
    for (const d of defs)
      if (d.required && (out[d.key] === undefined || out[d.key] === null))
        problems.push({ path: `fieldValues/${d.key}`, message: 'Required to send' });
  return { values: out, problems };
}

export interface CorrespondenceAudience {
  status: CorrespondenceStatus;
  isPrivate?: boolean;
  /** The viewer is on the item's private access list. */
  onAccessList?: boolean;
  createdBy: string | null;
  fromCompanyId: string | null;
  toCompanyIds: readonly string[];
}
export interface CorrespondenceViewer {
  userId: string;
  companyId: string | null;
  /** Builder staff (org members) see every sent item on the project. */
  isInternal: boolean;
  /** Staff only: org owner/admin, or admin level on the correspondence tool. */
  isAdmin: boolean;
}

/**
 * A draft stays with its author (and admins); once sent, staff and the sending and receiving companies can read
 * it. Other staff do not see or send someone else's draft, since an evidential notice binds the company.
 */
export function canSeeItem(a: CorrespondenceAudience, v: CorrespondenceViewer): boolean {
  if (a.createdBy === v.userId || (v.isInternal && v.isAdmin)) return true;
  // A private item is for its author, admins and the people listed on it, and only once it has been sent.
  if (a.isPrivate) return a.status !== 'draft' && a.onAccessList === true;
  if (v.isInternal) return a.status !== 'draft';
  if (a.status === 'draft' || !v.companyId) return false;
  return a.fromCompanyId === v.companyId || a.toCompanyIds.includes(v.companyId);
}

/** Only the author or an admin edits or sends a draft. */
export const canWriteDraft = (a: { createdBy: string | null }, v: CorrespondenceViewer) =>
  a.createdBy === v.userId || (v.isInternal && v.isAdmin);

/** Staff can answer anything; an outside user answers items their company sent or was sent. */
export function canRespondAs(a: CorrespondenceAudience, v: CorrespondenceViewer): boolean {
  if (v.isInternal) return true;
  if (!v.companyId) return false;
  return a.fromCompanyId === v.companyId || a.toCompanyIds.includes(v.companyId);
}

const TOKEN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** Fills `{{token}}` placeholders. Unknown tokens are left for the author to see. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(TOKEN, (m, key: string) => vars[key] ?? m);
}

/** 2027-03-18 → 18/03/2027, the form AU notices use. */
export const auDate = (iso: string) => iso.split('-').reverse().join('/');
