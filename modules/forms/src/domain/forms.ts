// Pure rules for custom forms: what a template may contain, whether an answer fits its field, what is still
// missing before a form can be submitted, which submissions need attention, and how fields are pre-filled.
import {
  addDays,
  compareLocalDates,
  daysBetween,
  isLocalDate,
  type LocalDate,
} from '@archova/time';

export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'yes_no',
  'single_select',
  'multi_select',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const SUBMISSION_STATUSES = ['assigned', 'in_progress', 'submitted', 'closed'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Keys a field may ask to be pre-filled from (resolved by the application layer; see `PREFILL_KEYS`). */
export const PREFILL_KEYS = [
  'project.name',
  'project.number',
  'project.address',
  'today',
  'incident.title',
  'incident.type',
  'incident.severity',
  'incident.date',
  'incident.location',
  'incident.description',
  'incident.immediateActions',
] as const;
export type PrefillKey = (typeof PREFILL_KEYS)[number];

export const MAX_FIELDS = 200;
export const MAX_OPTIONS = 50;
export const TEXT_MAX = 500;
export const LONG_TEXT_MAX = 5000;
export const STALE_DAYS = 7;
export const DUE_SOON_DAYS = 2;

export interface FieldDef {
  id: string;
  section: string;
  label: string;
  type: FieldType;
  required: boolean;
  helpText: string | null;
  options: string[];
  prefillKey: PrefillKey | null;
}

export type AnswerValue = string | number | boolean | string[];
export type Answers = Record<string, AnswerValue>;

const FIELD_ID = /^[a-z0-9_]{1,40}$/;

/** Problems with a template's field list as `{ path, message }`, empty when it is acceptable. */
export function fieldProblems(fields: readonly FieldDef[]): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  if (fields.length > MAX_FIELDS)
    out.push({ path: 'fields', message: `At most ${MAX_FIELDS} fields` });
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    const at = `fields/${i}`;
    if (!FIELD_ID.test(f.id))
      out.push({ path: `${at}/id`, message: 'Use a-z, 0-9 and _ (max 40)' });
    else if (seen.has(f.id)) out.push({ path: `${at}/id`, message: 'Duplicate field id' });
    seen.add(f.id);
    if (f.label.trim() === '') out.push({ path: `${at}/label`, message: 'Name the field' });
    const picks = f.type === 'single_select' || f.type === 'multi_select';
    if (picks && (f.options.length < 1 || f.options.length > MAX_OPTIONS))
      out.push({ path: `${at}/options`, message: `Give 1 to ${MAX_OPTIONS} options` });
    if (picks && new Set(f.options.map((o) => o.trim().toLowerCase())).size !== f.options.length)
      out.push({ path: `${at}/options`, message: 'Options must be different' });
    if (!picks && f.options.length > 0)
      out.push({ path: `${at}/options`, message: 'Only choice fields have options' });
  });
  return out;
}

const isEmpty = (v: AnswerValue | undefined): boolean =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

/** Why `value` does not fit `field`, or null when it does. An empty value is always fine here (see `missingRequired`). */
export function answerProblem(field: FieldDef, value: AnswerValue | undefined): string | null {
  if (isEmpty(value)) return null;
  switch (field.type) {
    case 'text':
      return typeof value === 'string' && value.length <= TEXT_MAX
        ? null
        : `Enter up to ${TEXT_MAX} characters`;
    case 'long_text':
      return typeof value === 'string' && value.length <= LONG_TEXT_MAX
        ? null
        : `Enter up to ${LONG_TEXT_MAX} characters`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'Enter a number';
    case 'date':
      return typeof value === 'string' && isLocalDate(value) ? null : 'Enter a date';
    case 'yes_no':
      return typeof value === 'boolean' ? null : 'Choose yes or no';
    case 'single_select':
      return typeof value === 'string' && field.options.includes(value)
        ? null
        : 'Choose one of the options';
    case 'multi_select':
      return Array.isArray(value) &&
        new Set(value).size === value.length &&
        value.every((v) => field.options.includes(v))
        ? null
        : 'Choose from the options';
  }
}

/** An unchecked yes/no is an answer (`false`); everything else is missing when empty. */
export function missingRequired(fields: readonly FieldDef[], answers: Answers): string[] {
  return fields.filter((f) => f.required && isEmpty(answers[f.id])).map((f) => f.id);
}

export type SubmissionFlag = 'overdue' | 'due_soon' | 'stale';

export interface FlagInput {
  status: SubmissionStatus;
  dueDate: LocalDate | null;
  today: LocalDate;
  updatedAt: Date;
  now: Date;
}

/**
 * What Nova raises on a form still to be done: past its due date, due within two days, or started and then left
 * for a week. Plain rules, no model: the same answer every time and nothing to explain.
 */
export function flagsFor(i: FlagInput): SubmissionFlag[] {
  if (i.status !== 'assigned' && i.status !== 'in_progress') return [];
  const out: SubmissionFlag[] = [];
  if (i.dueDate) {
    if (compareLocalDates(i.dueDate, i.today) < 0) out.push('overdue');
    else if (compareLocalDates(i.dueDate, addDays(i.today, DUE_SOON_DAYS)) <= 0)
      out.push('due_soon');
  }
  if (
    i.status === 'in_progress' &&
    (i.now.getTime() - i.updatedAt.getTime()) / 86_400_000 >= STALE_DAYS
  )
    out.push('stale');
  return out;
}

/** Whole days a form is late (0 when not late). */
export const daysLate = (dueDate: LocalDate, today: LocalDate): number =>
  Math.max(0, daysBetween(dueDate, today));

export interface Suggestion {
  fieldId: string;
  value: AnswerValue;
  source: string;
}

const SOURCE_LABEL: Record<string, string> = {
  project: 'Project',
  today: 'Today',
  incident: 'Incident',
};

/**
 * Answers Nova can offer from facts about the project or a related record. Only fields that ask for a key, are
 * still empty and can take the value are touched; a choice field matches an option ignoring case, and is left
 * alone when none matches. Nothing is saved: the person reviews and applies.
 */
export function suggestPrefill(
  fields: readonly FieldDef[],
  answers: Answers,
  facts: Readonly<Record<string, string>>,
): Suggestion[] {
  const out: Suggestion[] = [];
  for (const f of fields) {
    if (!f.prefillKey || !isEmpty(answers[f.id])) continue;
    const raw = facts[f.prefillKey];
    if (raw === undefined || raw.trim() === '') continue;
    const source = SOURCE_LABEL[f.prefillKey.split('.')[0]!] ?? 'Record';
    let value: AnswerValue | null = null;
    if (f.type === 'text') value = raw.slice(0, TEXT_MAX);
    else if (f.type === 'long_text') value = raw.slice(0, LONG_TEXT_MAX);
    else if (f.type === 'date') value = isLocalDate(raw) ? raw : null;
    else if (f.type === 'number') value = Number.isFinite(Number(raw)) ? Number(raw) : null;
    else if (f.type === 'single_select')
      value = f.options.find((o) => o.toLowerCase() === raw.trim().toLowerCase()) ?? null;
    else if (f.type === 'multi_select') {
      const hit = f.options.find((o) => o.toLowerCase() === raw.trim().toLowerCase());
      value = hit ? [hit] : null;
    }
    if (value !== null) out.push({ fieldId: f.id, value, source });
  }
  return out;
}

/** Allowed moves between statuses. */
export const TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  assigned: ['in_progress', 'submitted'],
  in_progress: ['in_progress', 'submitted'],
  submitted: ['in_progress', 'closed'],
  closed: [],
};
export const canMove = (from: SubmissionStatus, to: SubmissionStatus) =>
  TRANSITIONS[from].includes(to);

export const numberLabel = (n: number) => `FRM-${String(n).padStart(4, '0')}`;
