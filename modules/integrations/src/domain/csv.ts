// A small CSV reader for customer exports (RFC 4180 quoting; comma, semicolon or tab separated). Pure, no IO.
// Spreadsheets saved as CSV from Excel in Australia are usually comma separated, some regional exports use ';'.

export class CsvTooLarge extends Error {
  constructor(readonly limit: number) {
    super(`More than ${limit} rows`);
  }
}

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
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let sawAny = false;

  const endRow = () => {
    row.push(cell);
    records.push(row);
    if (records.length > maxRecords) throw new CsvTooLarge(maxRecords);
    row = [];
    cell = '';
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
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      sawAny = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
      sawAny = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      cell += ch;
      sawAny = true;
    }
  }
  if (sawAny || cell !== '') endRow();
  return records;
}

export const isBlankRecord = (r: readonly string[]) => r.every((c) => c.trim() === '');
