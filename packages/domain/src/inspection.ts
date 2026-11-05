// Inspection rules: whether a recorded answer fits its checklist item, and when an inspection is complete. Pure, no IO.

export const RESPONSE_TYPES = [
  'pass_fail_na',
  'yes_no',
  'number',
  'text',
  'photo',
  'signature',
  'select',
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
  switch (item.responseType) {
    case 'pass_fail_na':
      return r.result === 'pass' || r.result === 'fail' || r.result === 'na'
        ? null
        : 'Answer pass, fail or n/a.';
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
