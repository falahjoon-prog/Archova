import { describe, expect, it } from 'vitest';
import { cell, csvHeader, csvRows } from '../../src/domain/csv';
import { filePath, safeFilename } from '../../src/domain/archive';
import { planTables, unreviewedSensitiveColumns } from '../../src/domain/plan';

describe('csv', () => {
  it('quotes commas, quotes and newlines, and writes dates as ISO instants', () => {
    expect(cell('a,b', 'text')).toBe('"a,b"');
    expect(cell('say "hi"', 'text')).toBe('"say ""hi"""');
    expect(cell('two\nlines', 'text')).toBe('"two\nlines"');
    expect(cell(new Date('2026-11-05T01:02:03Z'), 'timestamp with time zone')).toBe(
      '2026-11-05T01:02:03.000Z',
    );
    expect(cell(null, 'text')).toBe('');
    expect(cell({ a: [1] }, 'jsonb')).toBe('"{""a"":[1]}"');
  });

  it('defuses spreadsheet formulas in text but leaves numbers alone', () => {
    expect(cell('=SUM(A1)', 'text')).toBe("'=SUM(A1)");
    expect(cell('@cmd', 'text')).toBe("'@cmd");
    expect(cell('-5 items', 'text')).toBe("'-5 items");
    expect(cell(-5, 'integer')).toBe('-5');
    expect(cell('-12.50', 'numeric')).toBe('-12.50');
  });

  it('starts with a byte-order mark and ends rows with CRLF', () => {
    expect(csvHeader(['a', 'b'])).toBe('﻿a,b\r\n');
    expect(
      csvRows(
        [{ a: 1, b: 'x' }],
        [
          { name: 'a', type: 'integer' },
          { name: 'b', type: 'text' },
        ],
      ),
    ).toBe('1,x\r\n');
  });
});

describe('archive names', () => {
  it('makes file names safe on every OS and keeps the extension', () => {
    expect(safeFilename('A/B:C*.pdf')).toBe('A_B_C_.pdf');
    expect(safeFilename('..hidden')).toBe('_hidden');
    expect(safeFilename('')).toBe('file');
    const long = safeFilename(`${'x'.repeat(300)}.pdf`);
    expect(long.length).toBe(100);
    expect(long.endsWith('.pdf')).toBe(true);
    expect(filePath({ module: 'documents', id: 'abc', filename: 'Plan 1.pdf' })).toBe(
      'files/documents/abc-Plan 1.pdf',
    );
  });
});

const t = (schema: string, name: string, ...cols: string[]) => ({
  schema,
  name,
  columns: cols.map((c) => ({ name: c, type: 'text' })),
});

describe('plan', () => {
  it('leaves out infrastructure schemas, named tables and named columns, and says why', () => {
    const plan = planTables([
      t('rfis', 'rfis', 'id', 'org_id', 'subject'),
      t('shared', 'outbox', 'id', 'org_id'),
      t('identity', 'api_tokens', 'id', 'org_id', 'token_hash'),
      t('integrations', 'accounting_connections', 'id', 'org_id', 'tokens_sealed'),
      t('platform', 'invitations', 'id', 'org_id', 'email', 'token_hash'),
    ]);
    expect(plan.include.map((p) => p.id)).toEqual(['platform.invitations', 'rfis.rfis']);
    expect(plan.include[0]!.columns.map((c) => c.name)).toEqual(['id', 'org_id', 'email']);
    expect(plan.excluded).toEqual([
      {
        table: 'integrations.accounting_connections',
        reason: expect.stringContaining('credentials'),
      },
    ]);
  });

  it('flags a new credential-looking column until someone reviews it', () => {
    const plan = planTables([t('rfis', 'rfis', 'id', 'org_id', 'api_secret', 'is_private')]);
    expect(unreviewedSensitiveColumns(plan)).toEqual(['rfis.rfis.api_secret']);
  });
});
