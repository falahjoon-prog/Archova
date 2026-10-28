// A small CSV reader for customer exports (RFC 4180 quoting; comma, semicolon or tab separated). Pure, no IO.
// Spreadsheets saved as CSV from Excel in Australia are usually comma separated, some regional exports use ';'.

export class CsvTooLarge extends Error {
  constructor(readonly limit: number) {
    super(`More than ${limit} rows`);
  }
}

/** A row with more cells, or a cell with more characters, than a register could have is not a spreadsheet. */
export class CsvTooWide extends Error {
  constructor(readonly reason: 'columns' | 'cell') {
    super(reason === 'columns' ? 'Too many columns' : 'A cell is too long');
  }
}

export const MAX_COLUMNS = 200;
export const MAX_CELL_CHARS = 10_000;

/** The separator the first line uses most, outside quotes. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch as keyof typeof counts]++;
  }
  if (counts['\t'] > 0 && counts['\t'] >= counts[','] && counts['\t'] >= counts[';']) return '\t';
  return counts[';'] > counts[','] ? ';' : ',';
}

/**
 * Records as arrays of cells, in file order, with the byte order mark dropped. Blank lines are kept (as a single
 * empty cell) so a record's index is its line among records. `maxRecords` stops a runaway file early.
 */
export function parseCsv(input: string, maxRecords: number): string[][] {
  // NUL characters can't be stored in jsonb, so they never reach the database.
  const stripped = input.includes('\u0000') ? input.replaceAll('\u0000', '') : input;
  const text = stripped.charCodeAt(0) === 0xfeff ? stripped.slice(1) : stripped;
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let sawAny = false;

  const pushCell = () => {
    if (cell.length > MAX_CELL_CHARS) throw new CsvTooWide('cell');
    row.push(cell);
    if (row.length > MAX_COLUMNS) throw new CsvTooWide('columns');
    cell = '';
  };

  const endRow = () => {
    pushCell();
    records.push(row);
    if (records.length > maxRecords) throw new CsvTooLarge(maxRecords);
    row = [];
    sawAny = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        cell += ch;
        if (cell.length > MAX_CELL_CHARS) throw new CsvTooWide('cell');
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      sawAny = true;
    } else if (ch === delimiter) {
      pushCell();
      sawAny = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      cell += ch;
      sawAny = true;
      if (cell.length > MAX_CELL_CHARS) throw new CsvTooWide('cell');
    }
  }
  if (sawAny || cell !== '') endRow();
  return records;
}

export const isBlankRecord = (r: readonly string[]) => r.every((c) => c.trim() === '');
