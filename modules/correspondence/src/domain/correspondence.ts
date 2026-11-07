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

export interface CorrespondenceAudience {
  status: CorrespondenceStatus;
  createdBy: string | null;
  fromCompanyId: string | null;
  toCompanyIds: readonly string[];
  /** A private item is seen only by its author, the admins and the people on its permissions list. */
  isPrivate?: boolean;
  accessUserIds?: readonly string[];
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
  if (a.status === 'draft') return false;
  // Private: the recipient companies do not see it unless a person from them is on the list.
  if (a.isPrivate) return a.accessUserIds?.includes(v.userId) ?? false;
  if (v.isInternal) return true;
  if (!v.companyId) return false;
  return a.fromCompanyId === v.companyId || a.toCompanyIds.includes(v.companyId);
}

/** Only the author or an admin edits or sends a draft. */
export const canWriteDraft = (a: { createdBy: string | null }, v: CorrespondenceViewer) =>
  a.createdBy === v.userId || (v.isInternal && v.isAdmin);

/** Only the author or an admin changes who can see an item, whatever state it is in. */
export const canManageAccess = canWriteDraft;

/** A sent notice that binds the company must reach the other side, so it cannot be hidden from them. */
export const canBePrivate = (i: { isEvidential: boolean; status: CorrespondenceStatus }) =>
  !(i.isEvidential && i.status !== 'draft');

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

// ---- type-specific fields ------------------------------------------------------------------------------------

export const FIELD_KINDS = ['text', 'date', 'number', 'boolean', 'select'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** The choices of a `select` field. */
  options: string[];
}
export type FieldValue = string | number | boolean;
export type FieldValues = Record<string, FieldValue>;

export const MAX_FIELD_DEFS = 12;
const KEY = /^[a-z][a-zA-Z0-9]{0,39}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type FieldProblem = { path: string; message: string };

/** The fields a type may ask for: unique keys, a label each, and choices for a select. */
export function checkFieldDefs(defs: readonly FieldDef[], path = 'fields'): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (defs.length > MAX_FIELD_DEFS)
    problems.push({ path, message: `At most ${MAX_FIELD_DEFS} fields` });
  const seen = new Set<string>();
  for (const [i, d] of defs.entries()) {
    const at = `${path}/${i}`;
    if (!KEY.test(d.key)) problems.push({ path: `${at}/key`, message: 'Use letters and digits' });
    else if (seen.has(d.key)) problems.push({ path: `${at}/key`, message: 'Already used' });
    seen.add(d.key);
    if (!d.label.trim() || d.label.length > 80)
      problems.push({ path: `${at}/label`, message: 'Give a label up to 80 characters' });
    if (d.kind === 'select') {
      if (d.options.length < 1 || d.options.length > 20)
        problems.push({ path: `${at}/options`, message: 'Give 1 to 20 choices' });
      if (d.options.some((o) => !o.trim() || o.length > 80))
        problems.push({ path: `${at}/options`, message: 'Each choice is up to 80 characters' });
    } else if (d.options.length)
      problems.push({ path: `${at}/options`, message: 'Only a select field has choices' });
  }
  return problems;
}

function validDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

/**
 * Checks values against an item's field definitions. `null` clears a value. Unknown keys and values of the wrong
 * kind are refused. Returns the merged values, and the problems found.
 */
export function mergeFieldValues(
  defs: readonly FieldDef[],
  current: FieldValues,
  patch: Record<string, FieldValue | null>,
): { values: FieldValues; problems: FieldProblem[] } {
  const values: FieldValues = { ...current };
  const problems: FieldProblem[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    const at = `fields/${key}`;
    const def = defs.find((d) => d.key === key);
    if (!def) {
      problems.push({ path: at, message: 'Not a field on this type' });
      continue;
    }
    if (raw === null) {
      delete values[key];
      continue;
    }
    const ok =
      (def.kind === 'text' && typeof raw === 'string' && raw.length <= 1000) ||
      (def.kind === 'date' && typeof raw === 'string' && validDate(raw)) ||
      (def.kind === 'number' && typeof raw === 'number' && Number.isFinite(raw)) ||
      (def.kind === 'boolean' && typeof raw === 'boolean') ||
      (def.kind === 'select' && typeof raw === 'string' && def.options.includes(raw));
    if (!ok) {
      problems.push({ path: at, message: `Not a valid ${def.kind} value` });
      continue;
    }
    values[key] = raw;
  }
  return { values, problems };
}

/** Required fields with no value yet; checked when the item is sent. */
export function missingRequiredFields(
  defs: readonly FieldDef[],
  values: FieldValues,
): FieldProblem[] {
  return defs
    .filter((d) => d.required && (values[d.key] === undefined || values[d.key] === ''))
    .map((d) => ({ path: `fields/${d.key}`, message: 'Required to send' }));
}

// ---- change history ------------------------------------------------------------------------------------------

export interface FieldChange {
  field: string;
  /** Short values only; long text records just that it changed. */
  from?: string | number | boolean | null;
  to?: string | number | boolean | null;
}

const SHORT = 200;
const shortValue = (v: unknown): string | number | boolean | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length <= SHORT ? v : undefined;
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  return undefined;
};

/** The differences between two versions of an item over the fields people edit, for the change history. */
export function diffItem(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: readonly string[],
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const k of keys) {
    if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
    const from = shortValue(before[k]);
    const to = shortValue(after[k]);
    out.push(from === undefined || to === undefined ? { field: k } : { field: k, from, to });
  }
  return out;
}

/** Per-field changes between two sets of type-specific values, named `fields.<key>`. */
export function diffFieldValues(before: FieldValues, after: FieldValues): FieldChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return diffItem(
    Object.fromEntries(keys.map((k) => [`fields.${k}`, before[k]])),
    Object.fromEntries(keys.map((k) => [`fields.${k}`, after[k]])),
    keys.map((k) => `fields.${k}`),
  );
}
