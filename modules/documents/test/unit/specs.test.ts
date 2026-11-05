import { describe, expect, it } from 'vitest';
import { cleanSections, divisionOf } from '../../src/application/specs';

describe('spec sections', () => {
  it('takes the division from a numeric section number', () => {
    expect(divisionOf('03 30 00')).toBe('03');
    expect(divisionOf('0330')).toBe('03');
    expect(divisionOf('A2.1')).toBeNull();
  });

  it('tidies the numbers and keeps the order', () => {
    const rows = cleanSections([
      { sectionNumber: ' 03  30 00 ', title: ' Concrete ', pageFrom: 4, pageTo: 20 },
      {
        sectionNumber: '09 30 00',
        title: 'Tiling',
        division: 'Finishes',
        pageFrom: 21,
        pageTo: 21,
        revision: 'B',
      },
    ]);
    expect(rows.map((r) => r.sectionNumber)).toEqual(['03 30 00', '09 30 00']);
    expect(rows[0]).toMatchObject({ title: 'Concrete', division: '03', revision: null });
    expect(rows[1]).toMatchObject({ division: 'Finishes', revision: 'B' });
  });

  it('refuses repeated numbers, blank titles and backwards page ranges', () => {
    const base = { title: 'T', pageFrom: 2, pageTo: 3 };
    expect(() =>
      cleanSections([
        { ...base, sectionNumber: '03 30 00' },
        { ...base, sectionNumber: '03  30 00' },
      ]),
    ).toThrow(/twice/);
    expect(() => cleanSections([{ ...base, sectionNumber: '1', title: ' ' }])).toThrow(/title/);
    expect(() => cleanSections([{ ...base, sectionNumber: '1', pageFrom: 5, pageTo: 4 }])).toThrow(
      /before the first/,
    );
  });
});
