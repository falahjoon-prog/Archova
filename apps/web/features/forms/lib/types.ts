import type { components } from '@archova/contracts/openapi';

export type FormTemplate = components['schemas']['FormTemplate'];
export type FormField = components['schemas']['FormField'];
export type FormFieldInput = components['schemas']['FormFieldInput'];
export type FormTemplateInput = components['schemas']['FormTemplateInput'];
export type FormSubmission = components['schemas']['FormSubmission'];
export type FormSubmissionDetail = components['schemas']['FormSubmissionDetail'];
export type FormSuggestion = components['schemas']['FormSuggestion'];
export type FormFieldType = components['schemas']['FormFieldType'];
export type FormPrefillKey = components['schemas']['FormPrefillKey'];
export type SubmissionStatus = components['schemas']['FormSubmissionStatus'];
export type SubmissionFlag = components['schemas']['FormSubmissionFlag'];
export type AnswerValue = string | number | boolean | string[];
export type Answers = Record<string, AnswerValue>;

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  date: 'Date',
  yes_no: 'Yes / no',
  single_select: 'Choose one',
  multi_select: 'Choose several',
};

export const STATUS_LABELS: Record<SubmissionStatus, string> = {
  assigned: 'Assigned',
  in_progress: 'In progress',
  submitted: 'Submitted',
  closed: 'Closed',
};

export const FLAG_LABELS: Record<SubmissionFlag, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  stale: 'Not touched for a week',
};

export const PREFILL_LABELS: Record<FormPrefillKey, string> = {
  'project.name': 'Project name',
  'project.number': 'Project number',
  'project.address': 'Project address',
  today: "Today's date",
  'incident.title': 'Incident: title',
  'incident.type': 'Incident: type',
  'incident.severity': 'Incident: severity',
  'incident.date': 'Incident: date',
  'incident.location': 'Incident: location',
  'incident.description': 'Incident: description',
  'incident.immediateActions': 'Incident: immediate actions',
};

export const hasChoices = (t: FormFieldType) => t === 'single_select' || t === 'multi_select';

/** A stable field id from its label: `Area made safe?` becomes `area_made_safe`, unique among `taken`. */
export function fieldIdFor(label: string, taken: readonly string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'field';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`;
  return id;
}

/** Fields grouped by section in the order sections first appear. */
export function bySection<T extends { section: string }>(fields: readonly T[]) {
  const out: Array<{ section: string; fields: T[] }> = [];
  for (const f of fields) {
    const g = out.find((s) => s.section === f.section);
    if (g) g.fields.push(f);
    else out.push({ section: f.section, fields: [f] });
  }
  return out;
}
