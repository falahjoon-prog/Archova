// Turns one staged row into Archova's fields and says what is wrong with it (integrations/07 §3). The field list
// comes from the same catalogue Nova's mapping suggestions use (@archova/ai-prompts); the owning module's import
// command still does its own validation when the rows are applied. Pure, no IO.

import type { ImportField } from '@archova/ai-prompts';

export interface Mapping {
  /** Field key → column index. */
  columns: Record<string, number>;
  /** Field key → source value as it appears in the file → the value Archova stores. */
  values: Record<string, Record<string, string>>;
}

export type Cell = string | number | null;
export interface RowProblem {
  field: string;
  message: string;
}
export interface NormalisedRow {
  fields: Record<string, Cell>;
  problems: RowProblem[];
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\-–—./:()]+/g, ' ')
    .replace(/[^\p{L}\p{N}# ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function isoDate(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/** A calendar date as `YYYY-MM-DD`. Slash dates are day first (Australian); Excel serial numbers are read too. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return isoDate(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:,? .*)?$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return isoDate(y, +m[2]!, +m[1]!);
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+),? (\d{2}|\d{4})(?:,? .*)?$/i.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    if (month < 0) return null;
    return isoDate(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, month + 1, +m[1]!);
  }
  if (/^\d{5}$/.test(s) && +s >= 20000 && +s <= 80000)
    return new Date(Date.UTC(1899, 11, 30) + +s * 86_400_000).toISOString().slice(0, 10);
  return null;
}

/** `RFI-087`, `#87` and `87` are all 87. */
export function parseNumber(raw: string): number | null {
  const m = /^[A-Za-z]*[\s#-]*0*(\d{1,9})$/.exec(raw.trim());
  return m ? Number(m[1]) : null;
}

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
/** The 11 digits of a valid ABN, or null (ATO checksum). */
export function parseAbn(raw: string): string | null {
  const digits = raw.replace(/\s+/g, '');
  if (!/^\d{11}$/.test(digits)) return null;
  const sum = [...digits].reduce(
    (acc, d, i) => acc + (i === 0 ? Number(d) - 1 : Number(d)) * ABN_WEIGHTS[i]!,
    0,
  );
  return sum % 89 === 0 ? digits : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function matchEnum(field: ImportField, raw: string, chosen: Record<string, string> | undefined) {
  const exact = chosen?.[raw];
  if (exact !== undefined) return field.values?.some((v) => v.value === exact) ? exact : null;
  const key = squash(raw);
  for (const v of field.values ?? []) {
    if (
      squash(v.value) === key ||
      squash(v.label) === key ||
      v.aliases.some((a) => squash(a) === key)
    )
      return v.value;
  }
  return null;
}

/** One row through the person's mapping. Required fields must be present; optional blanks become null. */
export function normaliseRow(
  fields: readonly ImportField[],
  mapping: Mapping,
  cells: readonly string[],
): NormalisedRow {
  const out: Record<string, Cell> = {};
  const problems: RowProblem[] = [];
  for (const f of fields) {
    const index = mapping.columns[f.key];
    const raw = index === undefined ? '' : (cells[index] ?? '').trim();
    if (raw === '') {
      out[f.key] = null;
      if (f.required) problems.push({ field: f.key, message: `${f.label} is required` });
      continue;
    }
    switch (f.kind) {
      case 'text':
        out[f.key] = raw;
        break;
      case 'number': {
        const n = parseNumber(raw);
        out[f.key] = n;
        if (n === null)
          problems.push({ field: f.key, message: `${f.label} "${raw}" is not a number` });
        break;
      }
      case 'date': {
        const d = parseDate(raw);
        out[f.key] = d;
        if (d === null)
          problems.push({ field: f.key, message: `${f.label} "${raw}" is not a date` });
        break;
      }
      case 'enum': {
        const v = matchEnum(f, raw, mapping.values[f.key]);
        out[f.key] = v;
        if (v === null)
          problems.push({ field: f.key, message: `${f.label} "${raw}" is not one we know` });
        break;
      }
      case 'email': {
        const ok = EMAIL.test(raw);
        out[f.key] = ok ? raw.toLowerCase() : null;
        if (!ok)
          problems.push({ field: f.key, message: `${f.label} "${raw}" is not an email address` });
        break;
      }
      case 'phone': {
        const digits = raw.replace(/[\s().-]+/g, '');
        const ok = /^\+?\d{8,15}$/.test(digits);
        out[f.key] = ok ? digits : null;
        if (!ok)
          problems.push({ field: f.key, message: `${f.label} "${raw}" is not a phone number` });
        break;
      }
      case 'abn': {
        const abn = parseAbn(raw);
        out[f.key] = abn;
        if (abn === null)
          problems.push({ field: f.key, message: `${f.label} "${raw}" is not a valid ABN` });
        break;
      }
    }
  }
  return { fields: out, problems };
}

/** Which required fields no column fills. */
export const missingRequired = (fields: readonly ImportField[], mapping: Mapping) =>
  fields.filter((f) => f.required && mapping.columns[f.key] === undefined).map((f) => f.key);
