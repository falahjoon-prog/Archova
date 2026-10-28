// F31 import mapping (ai/11 F31): the rules around the model's column suggestions. Pure, no IO. The model says which
// field each column fills; code keeps only fields that exist, gives each field to one column, checks the column's
// values look like that kind of field, completes the status-style value maps from the file's own values, and takes
// the examples shown to the person from the file, never from the model.
import {
  fieldsOf,
  type ImportColumn,
  type ImportConfidence,
  type ImportEntity,
  type ImportField,
  type ImportMappingOutput,
} from '@archova/ai-prompts';

export type ColumnWarning = 'duplicate_field' | 'unlike_values';

export interface MappedColumn {
  /** 0-based position in the file. */
  index: number;
  header: string;
  /** A field key of the record, or null: the column isn't imported. */
  field: string | null;
  confidence: ImportConfidence;
  /** The first distinct non-empty values in the file, for the person to check the suggestion against. */
  examples: string[];
  /** Why a suggestion was withdrawn or weakened; null when nothing was. */
  warning: ColumnWarning | null;
}

export interface MappedValues {
  index: number;
  field: string;
  /** Every value the file uses in this column and what it means; `value` null when the person must choose. */
  pairs: Array<{ source: string; value: string | null }>;
}

export interface ReviewedImportMapping {
  columns: MappedColumn[];
  values: MappedValues[];
  /** Required fields no column fills. */
  missingRequired: string[];
  /** Suggestions that named a column or field that doesn't exist, or repeated one. */
  dropped: number;
}

const RANK: Record<ImportConfidence, number> = { high: 2, medium: 1, low: 0 };
const EXAMPLES = 3;

export const normaliseHeader = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\-–—./:()]+/g, ' ')
    .replace(/[^\p{L}\p{N}# ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const MONTHS = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DATE_PATTERNS = [
  /^\d{4}-\d{1,2}-\d{1,2}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:z|[+-]\d{2}:?\d{2})?)?$/i,
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?:,? \d{1,2}:\d{2}(?::\d{2})?(?: ?[ap]m)?)?$/i,
  new RegExp(
    `^\\d{1,2}(?:st|nd|rd|th)? ${MONTHS},? \\d{2,4}(?:,? \\d{1,2}:\\d{2}(?: ?[ap]m)?)?$`,
    'i',
  ),
  new RegExp(`^${MONTHS} \\d{1,2}(?:st|nd|rd|th)?,? \\d{2,4}$`, 'i'),
];

/** An Excel date is a day count since 1900; 25,000 to 70,000 covers 1968 to 2091. */
const isExcelSerial = (s: string) => /^\d{5}(?:\.\d+)?$/.test(s) && +s >= 25000 && +s <= 70000;

const digits = (s: string) => s.replace(/\D/g, '');

/** Whether a value could belong to a field of this kind. Free text and fixed-value fields accept anything. */
export function fitsKind(kind: ImportField['kind'], value: string): boolean {
  const s = value.trim();
  switch (kind) {
    case 'number':
      return /^[A-Za-z][A-Za-z\- #]*\d+$|^#?\s*\d+$/.test(s);
    case 'date':
      return DATE_PATTERNS.some((p) => p.test(s)) || isExcelSerial(s);
    case 'email':
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
    case 'phone': {
      const n = digits(s).length;
      return n >= 8 && n <= 15 && /^[\d\s()+.-]+(?:ext\.? ?\d+)?$/i.test(s);
    }
    case 'abn':
      return digits(s).length === 11 && /^[\d\s]+$/.test(s);
    default:
      return true;
  }
}

/** The values to judge a column by: all distinct values when the file gave them, else the samples. */
const valuesOf = (c: ImportColumn) => (c.distinct ?? c.samples).filter((s) => s.trim() !== '');

function distinctNonEmpty(xs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** The stored value a file value means, from the words the catalog lists for each value; null when none match. */
export function valueFromAliases(field: ImportField, source: string): string | null {
  const s = normaliseHeader(source);
  if (!s) return null;
  for (const v of field.values ?? [])
    if (s === normaliseHeader(v.value) || s === normaliseHeader(v.label)) return v.value;
  for (const v of field.values ?? [])
    if (v.aliases.some((a) => s === normaliseHeader(a))) return v.value;
  return null;
}

export function reviewImportMapping(
  output: ImportMappingOutput,
  entity: ImportEntity,
  columns: readonly ImportColumn[],
): ReviewedImportMapping {
  const fields = new Map(fieldsOf(entity).map((f) => [f.key, f]));
  let dropped = 0;

  // The model's answer per column: the first entry for a real column, naming a real field.
  const answers = new Map<number, { field: string | null; confidence: ImportConfidence }>();
  for (const c of output.columns) {
    const index = Number(c.id.slice(1)) - 1;
    if (index < 0 || index >= columns.length || answers.has(index)) {
      dropped++;
      continue;
    }
    if (c.field !== null && !fields.has(c.field)) {
      dropped++;
      answers.set(index, { field: null, confidence: 'low' });
      continue;
    }
    answers.set(index, { field: c.field, confidence: c.confidence });
  }

  // Each field goes to one column: the surest, then the one whose header says it, then the earlier one.
  const claims = new Map<string, number[]>();
  for (const [index, a] of answers)
    if (a.field) claims.set(a.field, [...(claims.get(a.field) ?? []), index]);
  const lost = new Set<number>();
  for (const [key, indexes] of claims) {
    if (indexes.length < 2) continue;
    const f = fields.get(key)!;
    const names = new Set([f.key, f.label, ...f.aliases].map(normaliseHeader));
    const score = (i: number) =>
      RANK[answers.get(i)!.confidence] * 2 +
      (names.has(normaliseHeader(columns[i]!.header)) ? 1 : 0);
    const best = [...indexes].sort((a, b) => score(b) - score(a) || a - b)[0]!;
    for (const i of indexes) if (i !== best) lost.add(i);
  }

  const mapped: MappedColumn[] = columns.map((col, index) => {
    const a = answers.get(index);
    const examples = distinctNonEmpty(col.samples).slice(0, EXAMPLES);
    const none = (warning: ColumnWarning | null): MappedColumn => ({
      index,
      header: col.header,
      field: null,
      confidence: 'low',
      examples,
      warning,
    });
    if (!a || !a.field) return none(null);
    if (lost.has(index)) {
      dropped++;
      return none('duplicate_field');
    }
    const field = fields.get(a.field)!;
    const vals = valuesOf(col);
    let confidence = a.confidence;
    let warning: ColumnWarning | null = null;
    if (vals.length) {
      const fit = vals.filter((v) => fitsKind(field.kind, v)).length / vals.length;
      if (fit < 0.5) return none('unlike_values');
      if (fit < 0.8) {
        warning = 'unlike_values';
        if (RANK[confidence] > RANK.medium) confidence = 'medium';
      }
    }
    return { index, header: col.header, field: a.field, confidence, examples, warning };
  });

  // Value maps for columns that fill a field with fixed values: every value the file uses gets a row.
  const values: MappedValues[] = [];
  for (const m of mapped) {
    const field = m.field ? fields.get(m.field) : undefined;
    if (!field?.values) continue;
    const sources = distinctNonEmpty(columns[m.index]!.distinct ?? columns[m.index]!.samples);
    if (!sources.length) continue;
    const given = new Map<string, string | null>();
    for (const v of output.values)
      if (Number(v.id.slice(1)) - 1 === m.index)
        for (const p of v.pairs) given.set(normaliseHeader(p.source), p.value);
    const allowed = new Set(field.values.map((v) => v.value));
    values.push({
      index: m.index,
      field: field.key,
      pairs: sources.map((source) => {
        const said = given.get(normaliseHeader(source));
        const value = said && allowed.has(said) ? said : valueFromAliases(field, source);
        return { source, value };
      }),
    });
  }

  const filled = new Set(mapped.map((m) => m.field));
  return {
    columns: mapped,
    values,
    missingRequired: [...fields.values()]
      .filter((f) => f.required && !filled.has(f.key))
      .map((f) => f.key),
    dropped,
  };
}
