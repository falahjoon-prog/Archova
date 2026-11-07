// CSV for the export: UTF-8 with a byte-order mark (so Excel reads accents), CRLF line ends, RFC 4180 quoting.

const BOM = '﻿';

/** Text a spreadsheet would run as a formula gets a leading apostrophe (OWASP CSV injection); numbers are left alone. */
const FORMULA_START = /^[=+\-@\t\r]/;

const NUMERIC_TYPES = /^(smallint|integer|bigint|numeric|real|double precision)$/;

export function cell(value: unknown, type: string): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (Buffer.isBuffer(value)) s = `\\x${value.toString('hex')}`;
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);
  if (!NUMERIC_TYPES.test(type) && typeof value === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvHeader = (names: readonly string[]) => `${BOM}${names.join(',')}\r\n`;

export function csvRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<{ name: string; type: string }>,
): string {
  let out = '';
  for (const r of rows) out += `${columns.map((c) => cell(r[c.name], c.type)).join(',')}\r\n`;
  return out;
}
