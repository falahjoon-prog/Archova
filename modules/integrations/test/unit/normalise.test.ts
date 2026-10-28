import { describe, expect, it } from 'vitest';
import { fieldsOf } from '@archova/ai-prompts';
import {
  missingRequired,
  normaliseRow,
  parseAbn,
  parseDate,
  parseNumber,
  type Mapping,
} from '../../src/domain/normalise';

describe('values', () => {
  it('reads dates day first and as ISO, and refuses ones that are not real', () => {
    expect(parseDate('2026-03-04')).toBe('2026-03-04');
    expect(parseDate('4/3/2026')).toBe('2026-03-04');
    expect(parseDate('04.03.26')).toBe('2026-03-04');
    expect(parseDate('4 March 2026')).toBe('2026-03-04');
    expect(parseDate('3rd Oct 2026, 9:30')).toBe('2026-10-03');
    expect(parseDate('46085')).toBe('2026-03-04');
    expect(parseDate('31/2/2026')).toBeNull();
    expect(parseDate('soon')).toBeNull();
  });

  it('reads numbers with prefixes', () => {
    expect(parseNumber('RFI-087')).toBe(87);
    expect(parseNumber('#12')).toBe(12);
    expect(parseNumber('  7 ')).toBe(7);
    expect(parseNumber('RFI-12b')).toBeNull();
  });

  it('checks the ABN checksum', () => {
    expect(parseAbn('51 824 753 556')).toBe('51824753556');
    expect(parseAbn('51 824 753 557')).toBeNull();
    expect(parseAbn('123')).toBeNull();
  });
});

describe('a row through a mapping', () => {
  const fields = fieldsOf('rfi');
  const mapping: Mapping = {
    columns: { number: 0, subject: 1, status: 2, openedAt: 3 },
    values: { status: { 'Closed - Answered': 'closed' } },
  };

  it("normalises a good row, using the person's value map and the known aliases", () => {
    const a = normaliseRow(fields, mapping, [
      'RFI-087',
      'Slab edge',
      'Closed - Answered',
      '4/3/2026',
    ]);
    expect(a.problems).toEqual([]);
    expect(a.fields).toMatchObject({
      number: 87,
      subject: 'Slab edge',
      status: 'closed',
      openedAt: '2026-03-04',
      question: null,
    });
    const b = normaliseRow(fields, mapping, ['88', 'Door', 'Replied', '2026-03-05']);
    expect(b.fields.status).toBe('answered');
  });

  it('names every problem with the field it is on', () => {
    const r = normaliseRow(fields, mapping, ['x', '', 'Mystery', '31/2/2026']);
    expect(r.problems.map((p) => p.field).sort()).toEqual([
      'number',
      'openedAt',
      'status',
      'subject',
    ]);
  });

  it('reports required fields with no column', () => {
    expect(missingRequired(fields, { columns: { number: 0 }, values: {} }).sort()).toEqual([
      'openedAt',
      'status',
      'subject',
    ]);
    expect(missingRequired(fields, mapping)).toEqual([]);
  });
});
