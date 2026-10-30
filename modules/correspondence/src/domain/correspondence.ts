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
