// Reads a budget spreadsheet saved as CSV (Excel's "Save as CSV"). Quoted fields, a BOM and CRLF line ends are handled.

export interface ImportRow {
  code: string;
  codeDescription?: string;
  description?: string;
  original: string;
  isMargin?: boolean;
}

export const TEMPLATE_HEADERS = [
  'Cost code',
  'Cost code description',
  'Original budget (AUD ex GST)',
  'Note',
  'Margin (yes/no)',
] as const;

export const templateCsv = () =>
  [
    TEMPLATE_HEADERS.join(','),
    '03-100,Concrete and formwork,482500.00,Includes pump hire,no',
    '09-200,Painting,64000.00,,no',
    '99-000,Margin,210000.00,,yes',
  ].join('\r\n') + '\r\n';

/** RFC 4180 style parse into rows of cells. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const COLS = {
  code: ['costcode', 'code'],
  codeDescription: ['costcodedescription', 'codedescription'],
  original: ['originalbudgetaudexgst', 'originalbudget', 'original', 'amount', 'budget'],
  description: ['note', 'notes', 'description'],
  margin: ['marginyesno', 'margin', 'ismargin'],
} as const;

export interface ParsedImport {
  rows: ImportRow[];
  /** Why the file can't be read at all, such as a missing column. */
  problem: string | null;
}

/** Turns CSV text into import rows by header name, so column order does not matter. */
export function parseBudgetCsv(text: string): ParsedImport {
  const table = parseCsv(text);
  const head = table[0];
  if (!head) return { rows: [], problem: 'The file is empty.' };
  const find = (names: readonly string[]) => head.findIndex((h) => names.includes(norm(h)));
  const at = {
    code: find(COLS.code),
    codeDescription: find(COLS.codeDescription),
    original: find(COLS.original),
    description: find(COLS.description),
    margin: find(COLS.margin),
  };
  if (at.code < 0 || at.original < 0)
    return {
      rows: [],
      problem:
        'The first row needs the headings "Cost code" and "Original budget (AUD ex GST)". Use the template.',
    };
  const rows = table.slice(1).map((r): ImportRow => {
    const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const money = get(at.original).replace(/^\$/, '').replace(/,/g, '');
    return {
      code: get(at.code),
      ...(get(at.codeDescription) ? { codeDescription: get(at.codeDescription) } : {}),
      ...(get(at.description) ? { description: get(at.description) } : {}),
      original: money,
      ...(/^(y|yes|true|1)$/i.test(get(at.margin)) ? { isMargin: true } : {}),
    };
  });
  return { rows, problem: null };
}
