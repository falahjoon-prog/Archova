import { describe, expect, it } from 'vitest';
import { parseBudgetCsv, parseCsv, templateCsv } from '../lib/importCsv';

describe('importCsv', () => {
  it('reads quoted fields, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,"b,c"\r\n"d ""x""",e\r\n')).toEqual([
      ['a', 'b,c'],
      ['d "x"', 'e'],
    ]);
  });

  it('round-trips the template into import rows', () => {
    const { rows, problem } = parseBudgetCsv(templateCsv());
    expect(problem).toBeNull();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      code: '03-100',
      codeDescription: 'Concrete and formwork',
      description: 'Includes pump hire',
      original: '482500.00',
    });
    expect(rows[2]?.isMargin).toBe(true);
  });

  it('strips currency symbols and thousands separators, and ignores column order', () => {
    const { rows } = parseBudgetCsv(
      'Original budget (AUD ex GST),Cost code\r\n"$1,250.50",01-000\r\n',
    );
    expect(rows).toEqual([{ code: '01-000', original: '1250.50' }]);
  });

  it('explains a file without the required headings', () => {
    expect(parseBudgetCsv('foo,bar\r\n1,2\r\n').problem).toMatch(/Use the template/);
    expect(parseBudgetCsv('').problem).toMatch(/empty/);
  });
});
