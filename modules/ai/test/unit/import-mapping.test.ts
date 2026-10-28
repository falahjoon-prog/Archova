import { describe, expect, it } from 'vitest';
import type { ImportColumn, ImportMappingOutput } from '@archova/ai-prompts';
import { IMPORT_FIELDS } from '@archova/ai-prompts';
import {
  fitsKind,
  normaliseHeader,
  reviewImportMapping,
  valueFromAliases,
} from '../../src/domain/import-mapping';

const col = (header: string, samples: string[], distinct?: string[]): ImportColumn => ({
  header,
  samples,
  ...(distinct ? { distinct } : {}),
});

const out = (
  columns: Array<[string, string | null, 'high' | 'medium' | 'low']>,
  values: ImportMappingOutput['values'] = [],
): ImportMappingOutput => ({
  columns: columns.map(([id, field, confidence]) => ({ id, field, confidence })),
  values,
});

const COLUMNS = [
  col('Ref', ['RFI-14', 'RFI-15']),
  col('Title', ['Fire rating at riser', 'Paint system in lobby']),
  col('Raised', ['04/03/2026', '11/03/2026']),
  col('Status', ['Open'], ['Open', 'Closed - Answered', 'On hold']),
];

describe('fitsKind', () => {
  it('reads dates the way builders write them', () => {
    for (const d of [
      '2026-03-04',
      '2026-03-04T09:30:00Z',
      '4/3/2026',
      '04-03-26',
      '04.03.2026 14:05',
      '4 Mar 2026',
      '4th March 2026',
      'March 4, 2026',
      '46085',
    ])
      expect(fitsKind('date', d), d).toBe(true);
    for (const d of ['Sam Nguyen', 'N/A', '12', '123456789'])
      expect(fitsKind('date', d), d).toBe(false);
  });

  it('reads numbers, emails, phones and ABNs', () => {
    expect(['RFI-0087', '087', '#12', 'DEF 3'].every((x) => fitsKind('number', x))).toBe(true);
    expect(['Level 3 wall', ''].some((x) => fitsKind('number', x))).toBe(false);
    expect(fitsKind('email', 'sam@brush.example')).toBe(true);
    expect(fitsKind('email', 'Sam Nguyen')).toBe(false);
    expect(
      ['0412 345 678', '(02) 4929 1234', '+61 2 4929 1234'].every((x) => fitsKind('phone', x)),
    ).toBe(true);
    expect(fitsKind('phone', '30 days')).toBe(false);
    expect(fitsKind('abn', '51 824 753 556')).toBe(true);
    expect(fitsKind('abn', '51824753556')).toBe(true);
    expect(fitsKind('abn', '30 days')).toBe(false);
    expect(fitsKind('text', 'anything')).toBe(true);
  });
});

describe('reviewImportMapping', () => {
  it('keeps only columns and fields that exist, and counts what it drops', () => {
    const r = reviewImportMapping(
      out([
        ['c1', 'number', 'high'],
        ['c2', 'subject', 'high'],
        ['c3', 'madeUpField', 'high'],
        ['c9', 'question', 'high'],
        ['c2', 'question', 'high'],
      ]),
      'rfi',
      COLUMNS,
    );
    expect(r.columns.map((c) => c.field)).toEqual(['number', 'subject', null, null]);
    expect(r.dropped).toBe(3);
  });

  it('gives a field to one column: the surest, then the one whose header says it, then the earlier', () => {
    const cols = [col('Notes', ['a']), col('Heading', ['b']), col('Subject', ['c'])];
    const surest = reviewImportMapping(
      out([
        ['c1', 'subject', 'low'],
        ['c2', 'subject', 'high'],
      ]),
      'rfi',
      cols,
    );
    expect(surest.columns.map((c) => c.field)).toEqual([null, 'subject', null]);
    expect(surest.columns[0]!.warning).toBe('duplicate_field');

    const byHeader = reviewImportMapping(
      out([
        ['c2', 'subject', 'medium'],
        ['c3', 'subject', 'medium'],
      ]),
      'rfi',
      cols,
    );
    expect(byHeader.columns.map((c) => c.field)).toEqual([null, null, 'subject']);

    const earlier = reviewImportMapping(
      out([
        ['c1', 'question', 'medium'],
        ['c2', 'question', 'medium'],
      ]),
      'rfi',
      cols,
    );
    expect(earlier.columns.map((c) => c.field)).toEqual(['question', null, null]);
  });

  it('withdraws a suggestion whose values do not look like the field, and softens a doubtful one', () => {
    const cols = [
      col('Raised', ['Sam Nguyen', 'Priya Shah']),
      col('Due', ['04/03/2026', 'ASAP', 'Friday', '11/03/2026', '12/03/2026']),
      col('Closed', ['2026-04-01', '2026-04-02']),
    ];
    const r = reviewImportMapping(
      out([
        ['c1', 'openedAt', 'high'],
        ['c2', 'dueDate', 'high'],
        ['c3', 'closedAt', 'high'],
      ]),
      'rfi',
      cols,
    );
    expect(r.columns[0]).toMatchObject({ field: null, warning: 'unlike_values' });
    // Three of five fit: kept, but no better than medium and flagged.
    expect(r.columns[1]).toMatchObject({
      field: 'dueDate',
      confidence: 'medium',
      warning: 'unlike_values',
    });
    expect(r.columns[2]).toMatchObject({ field: 'closedAt', confidence: 'high', warning: null });
  });

  it('judges a column by every distinct value when the file gave them', () => {
    const cols = [
      col('Raised', ['04/03/2026', '05/03/2026'], ['04/03/2026', 'unknown', 'n/a', 'tbc']),
    ];
    const r = reviewImportMapping(out([['c1', 'openedAt', 'high']]), 'rfi', cols);
    expect(r.columns[0]).toMatchObject({ field: null, warning: 'unlike_values' });
  });

  it('shows examples from the file, not from the model', () => {
    const r = reviewImportMapping(out([['c1', 'number', 'high']]), 'rfi', [
      col('Ref', ['RFI-14', 'RFI-14', '', 'RFI-15', 'RFI-16', 'RFI-17']),
    ]);
    expect(r.columns[0]!.examples).toEqual(['RFI-14', 'RFI-15', 'RFI-16']);
  });

  it('lists every value the file uses with what it means, using the file’s words when the model leaves one out', () => {
    const r = reviewImportMapping(
      out(
        [
          ['c1', 'number', 'high'],
          ['c2', 'subject', 'high'],
          ['c4', 'status', 'high'],
        ],
        [
          {
            id: 'c4',
            pairs: [
              { source: 'Open', value: 'open' },
              { source: 'On hold', value: 'paused' },
              { source: 'Made up', value: 'answered' },
            ],
          },
        ],
      ),
      'rfi',
      COLUMNS,
    );
    expect(r.values).toEqual([
      {
        index: 3,
        field: 'status',
        pairs: [
          { source: 'Open', value: 'open' },
          // The model left this one out, but the catalog knows the words.
          { source: 'Closed - Answered', value: 'closed' },
          // The model's word isn't one of the field's values, and the catalog doesn't know "on hold": the person chooses.
          { source: 'On hold', value: null },
        ],
      },
    ]);
  });

  it('gives value rows only to columns that fill a field with fixed values', () => {
    const r = reviewImportMapping(
      out([['c2', 'subject', 'high']], [{ id: 'c2', pairs: [{ source: 'x', value: 'open' }] }]),
      'rfi',
      [col('Ref', ['1']), col('Title', ['a'], ['a', 'b'])],
    );
    expect(r.values).toEqual([]);
  });

  it('lists the required fields no column fills', () => {
    const r = reviewImportMapping(out([['c2', 'subject', 'high']]), 'rfi', COLUMNS);
    expect(r.missingRequired).toEqual(['number', 'status', 'openedAt']);
    const none = reviewImportMapping(out([]), 'company', [col('A', ['x'])]);
    expect(none.missingRequired).toEqual(['name']);
  });
});

describe('valueFromAliases', () => {
  const status = IMPORT_FIELDS.rfi.find((f) => f.key === 'status')!;
  it('knows the words other tools use for a value, ignoring case and punctuation', () => {
    expect(valueFromAliases(status, 'CLOSED – Answered')).toBe('closed');
    expect(valueFromAliases(status, 'pending response')).toBe('open');
    expect(valueFromAliases(status, 'Void')).toBe('void');
    expect(valueFromAliases(status, 'on hold')).toBeNull();
    expect(valueFromAliases(status, '')).toBeNull();
  });
});

describe('normaliseHeader', () => {
  it('folds case, punctuation and spacing but keeps #', () => {
    expect(normaliseHeader('  Date_Raised ')).toBe('date raised');
    expect(normaliseHeader('E-mail')).toBe('e mail');
    expect(normaliseHeader('Item #')).toBe('item #');
    expect(normaliseHeader('Done?')).toBe('done');
  });
});
