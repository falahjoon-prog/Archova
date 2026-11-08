// Inspection rules: whether a recorded answer fits its checklist item, and when an inspection is complete. Pure, no IO.

export const RESPONSE_TYPES = [
  'pass_fail_na',
  'yes_no',
  'number',
  'text',
  'photo',
  'signature',
  'select',
  'date',
] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];
export type ItemResult = 'pass' | 'fail' | 'na';

export interface ItemSpec {
  id: string;
  prompt: string;
  responseType: ResponseType;
  options: string[];
  required: boolean;
  createsDefectOnFail: boolean;
}

export interface ResponseInput {
  value?: unknown;
  result?: ItemResult | null;
  note?: string | null;
  fileIds?: string[];
}

export interface ResponseState {
  value: unknown;
  result: ItemResult | null;
  fileIds: string[];
}

/** Why an answer doesn't fit its item, or null when it does. */
export function responseProblem(item: ItemSpec, r: ResponseInput): string | null {
  const files = r.fileIds ?? [];
  // N/A is an override on any item, whatever its response type.
  if (r.result === 'na') return null;
  if ((r.result === 'pass' || r.result === 'fail') && item.responseType !== 'pass_fail_na')
    return 'Only pass/fail items take a pass or fail result.';
  switch (item.responseType) {
    case 'pass_fail_na':
      return r.result === 'pass' || r.result === 'fail' ? null : 'Answer pass, fail or n/a.';
    case 'yes_no':
      return typeof r.value === 'boolean' ? null : 'Answer yes or no.';
    case 'number':
      return typeof r.value === 'number' && Number.isFinite(r.value) ? null : 'Enter a number.';
    case 'text':
      return typeof r.value === 'string' && r.value.trim() !== '' ? null : 'Enter some text.';
    case 'select':
      return typeof r.value === 'string' && item.options.includes(r.value)
        ? null
        : 'Choose one of the listed options.';
    case 'photo':
      return files.length > 0 ? null : 'Attach a photo.';
    case 'date':
      return typeof r.value === 'string' && isIsoDate(r.value) ? null : 'Enter a date.';
    case 'signature':
      return files.length > 0 || (typeof r.value === 'string' && r.value.trim() !== '')
        ? null
        : 'A signature is required.';
  }
}

/** An item counts as answered once it holds a valid answer; a failed check always needs a note or a photo. */
export function isAnswered(item: ItemSpec, r: ResponseState | undefined): boolean {
  if (!r) return false;
  return (
    responseProblem(item, {
      value: r.value,
      result: r.result,
      fileIds: r.fileIds,
    }) === null
  );
}

export function missingRequired(
  items: readonly ItemSpec[],
  responses: ReadonlyMap<string, ResponseState>,
): ItemSpec[] {
  return items.filter((i) => i.required && !isAnswered(i, responses.get(i.id)));
}

export function failedItems(
  items: readonly ItemSpec[],
  responses: ReadonlyMap<string, ResponseState>,
): ItemSpec[] {
  return items.filter((i) => responses.get(i.id)?.result === 'fail');
}

export const INSPECTION_STATUSES = ['scheduled', 'in_progress', 'submitted', 'closed'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

/** Answers can be recorded until the inspection is submitted. */
export const isEditable = (s: InspectionStatus) => s === 'scheduled' || s === 'in_progress';

export const inspectionLabel = (n: number) => `INS-${String(n).padStart(4, '0')}`;

const isIsoDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

export interface SectionSummary {
  section: string;
  items: number;
  /** An answer that isn't pass, fail or N/A (a number, text, date, choice, photo or signature). */
  answered: number;
  pass: number;
  fail: number;
  na: number;
  unanswered: number;
  isNa: boolean;
}

/**
 * Per-section counts for the strip under a section heading. A section marked N/A counts every item as N/A and none as
 * required. Sections keep the order their first item has on the checklist.
 */
export function sectionSummaries(
  items: readonly (ItemSpec & { section: string })[],
  responses: ReadonlyMap<string, ResponseState>,
  naSections: ReadonlySet<string>,
): SectionSummary[] {
  const out = new Map<string, SectionSummary>();
  for (const item of items) {
    const s = out.get(item.section) ?? {
      section: item.section,
      items: 0,
      answered: 0,
      pass: 0,
      fail: 0,
      na: 0,
      unanswered: 0,
      isNa: naSections.has(item.section),
    };
    out.set(item.section, s);
    s.items++;
    const r = responses.get(item.id);
    if (s.isNa || r?.result === 'na') s.na++;
    else if (!isAnswered(item, r)) s.unanswered++;
    else if (r?.result === 'pass') s.pass++;
    else if (r?.result === 'fail') s.fail++;
    else s.answered++;
  }
  return [...out.values()];
}

/** Required items still open, ignoring items in sections marked N/A. */
export function missingRequiredIn(
  items: readonly (ItemSpec & { section: string })[],
  responses: ReadonlyMap<string, ResponseState>,
  naSections: ReadonlySet<string>,
): ItemSpec[] {
  return missingRequired(
    items.filter((i) => !naSections.has(i.section)),
    responses,
  );
}
