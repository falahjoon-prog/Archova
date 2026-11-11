// Form field definitions and answers. A template is a list of fields; a form copies that list when it starts, so
// editing a template never changes a form already started. Answers are keyed by field key.

export const FIELD_TYPES = [
  'heading',
  'text',
  'longtext',
  'number',
  'date',
  'checkbox',
  'select',
  'checklist',
  'table',
  'photo',
  'signature',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FORM_CATEGORIES = ['safety', 'quality', 'site', 'admin', 'general'] as const;
export type FormCategory = (typeof FORM_CATEGORIES)[number];

export const LINK_MODULES = ['diary', 'incidents', 'inspections', 'attendance'] as const;
export type LinkModule = (typeof LINK_MODULES)[number];

export interface FormField {
  key: string;
  type: FieldType;
  label: string;
  help?: string;
  required?: boolean;
  options?: string[];
  columns?: { key: string; label: string }[];
  rows?: number;
  slots?: number;
}

export type Answers = Record<string, unknown>;

export const TEXT_MAX = 5000;
export const CELL_MAX = 1000;
export const TABLE_ROWS_MAX = 100;
export const PHOTOS_MAX = 20;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const FILE_ID = /^fil_[0-9A-Za-z]{26}$/;

export interface FieldProblem {
  path: string;
  message: string;
}

/** Problems with a template's field list; empty when it can be saved. */
export function fieldListProblems(fields: readonly FormField[]): FieldProblem[] {
  const out: FieldProblem[] = [];
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    const at = `fields/${i}`;
    if (!KEY.test(f.key)) out.push({ path: `${at}/key`, message: 'Use a key like "hazard_1"' });
    if (seen.has(f.key)) out.push({ path: `${at}/key`, message: 'Two fields share this key' });
    seen.add(f.key);
    if (!f.label.trim()) out.push({ path: `${at}/label`, message: 'Give the field a label' });
    if ((f.type === 'select' || f.type === 'checklist') && !(f.options && f.options.length > 0))
      out.push({ path: `${at}/options`, message: 'Add at least one option' });
    if (f.type === 'table') {
      if (!(f.columns && f.columns.length > 0))
        out.push({ path: `${at}/columns`, message: 'Add at least one column' });
      const cols = new Set<string>();
      for (const c of f.columns ?? []) {
        if (cols.has(c.key))
          out.push({ path: `${at}/columns`, message: 'Two columns share a key' });
        cols.add(c.key);
      }
    }
    if (f.type === 'heading' && f.required)
      out.push({ path: `${at}/required`, message: 'A heading cannot be required' });
  });
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Cleans the answers a person sent: keeps only known fields, trims text, and refuses a value of the wrong shape.
 * Signatures are never accepted here (they are added one at a time, with a server time).
 */
export function cleanAnswers(
  fields: readonly FormField[],
  raw: Answers,
): { answers: Answers; problems: FieldProblem[] } {
  const answers: Answers = {};
  const problems: FieldProblem[] = [];
  const bad = (key: string, message: string) => problems.push({ path: `answers/${key}`, message });
  for (const f of fields) {
    if (f.type === 'heading' || f.type === 'signature') continue;
    if (!(f.key in raw)) continue;
    const v = raw[f.key];
    if (v === null || v === undefined) continue;
    switch (f.type) {
      case 'text':
      case 'longtext': {
        const max = f.type === 'text' ? 500 : TEXT_MAX;
        if (typeof v !== 'string') bad(f.key, 'Enter text');
        else if (v.length > max) bad(f.key, `Keep this under ${max} characters`);
        else answers[f.key] = v.trim();
        break;
      }
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) bad(f.key, 'Enter a number');
        else answers[f.key] = v;
        break;
      case 'date':
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad(f.key, 'Enter a date');
        else answers[f.key] = v;
        break;
      case 'checkbox':
        if (typeof v !== 'boolean') bad(f.key, 'Tick or untick');
        else answers[f.key] = v;
        break;
      case 'select':
        if (typeof v !== 'string' || (v !== '' && !f.options?.includes(v)))
          bad(f.key, 'Choose one of the options');
        else answers[f.key] = v;
        break;
      case 'checklist':
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !f.options?.includes(x)))
          bad(f.key, 'Choose from the listed items');
        else answers[f.key] = [...new Set(v as string[])];
        break;
      case 'table': {
        if (!Array.isArray(v) || v.length > TABLE_ROWS_MAX) {
          bad(f.key, `A table holds up to ${TABLE_ROWS_MAX} rows`);
          break;
        }
        const cols = new Set((f.columns ?? []).map((c) => c.key));
        const rows: Record<string, string>[] = [];
        let ok = true;
        for (const r of v) {
          if (!isRecord(r)) {
            ok = false;
            break;
          }
          const row: Record<string, string> = {};
          for (const [k, cell] of Object.entries(r)) {
            if (!cols.has(k) || typeof cell !== 'string' || cell.length > CELL_MAX) ok = false;
            else row[k] = cell.trim();
          }
          rows.push(row);
        }
        if (!ok) bad(f.key, 'Check the table cells');
        else answers[f.key] = rows;
        break;
      }
      case 'photo':
        if (
          !Array.isArray(v) ||
          v.length > PHOTOS_MAX ||
          v.some((x) => typeof x !== 'string' || !FILE_ID.test(x))
        )
          bad(f.key, `Attach up to ${PHOTOS_MAX} photos`);
        else answers[f.key] = v;
        break;
    }
  }
  return { answers, problems };
}

const blankRow = (r: Record<string, string>) => Object.values(r).every((c) => !c.trim());

/** Required fields and signature slots still empty; submitting is refused until this is empty. */
export function missingForSubmit(
  fields: readonly FormField[],
  answers: Answers,
  signatureCounts: ReadonlyMap<string, number>,
): FieldProblem[] {
  const out: FieldProblem[] = [];
  for (const f of fields) {
    if (f.type === 'heading') continue;
    if (f.type === 'signature') {
      // Slots are the most people who can sign; a required field needs at least one.
      if (f.required && (signatureCounts.get(f.key) ?? 0) < 1)
        out.push({
          path: `answers/${f.key}`,
          message: `${f.label}: at least one signature needed`,
        });
      continue;
    }
    if (!f.required) continue;
    const v = answers[f.key];
    const empty =
      v === undefined ||
      v === '' ||
      (f.type === 'checkbox' && v !== true) ||
      (Array.isArray(v) &&
        (v.length === 0 ||
          (f.type === 'table' && (v as Record<string, string>[]).every(blankRow))));
    if (empty) out.push({ path: `answers/${f.key}`, message: `${f.label} is required` });
  }
  return out;
}
