import { describe, expect, it } from 'vitest';
import { disciplineLabel, groupByDiscipline, registerCsv, type DrawingSheet } from '../lib/types';

describe('disciplineLabel', () => {
  it('names known codes and the H alias for hydraulic', () => {
    expect(disciplineLabel('A')).toBe('Architectural');
    expect(disciplineLabel('HY')).toBe('Hydraulic');
    expect(disciplineLabel('H')).toBe('Hydraulic');
  });

  it('shows other codes as entered and a dash for none', () => {
    expect(disciplineLabel('ID')).toBe('ID');
    expect(disciplineLabel(null)).toBe('—');
  });
});

describe('groupByDiscipline', () => {
  const sheet = (id: string, discipline: string | null) =>
    ({
      id,
      sheetNumber: id,
      title: id,
      discipline,
      area: null,
      currentRevisionId: id,
      currentRev: 'A',
      currentIssuedFor: null,
      currentDrawingDate: null,
      currentSetId: null,
      revisionCount: null,
    }) satisfies DrawingSheet;

  it('orders known disciplines first, then other codes, then none; folds the H alias', () => {
    const groups = groupByDiscipline([
      sheet('n', null),
      sheet('x', 'ID'),
      sheet('h', 'H'),
      sheet('e', 'E'),
      sheet('a', 'A'),
      sheet('hy', 'HY'),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      'Architectural',
      'Electrical',
      'Hydraulic',
      'ID',
      'No discipline',
    ]);
    expect(groups[2]!.sheets).toHaveLength(2);
  });

  it('writes the register as CSV with received date and set, guarding formulas', () => {
    const groups = groupByDiscipline([{ ...sheet('=A-1', 'A'), currentSetId: 's1' }]);
    const csv = registerCsv(groups, () => ({
      id: 's1',
      name: 'Design: 75%',
      status: 'published',
      issuedDate: '2026-06-01',
      receivedDate: '2026-06-02',
    }));
    expect(csv.split('\r\n')[1]).toBe("'=A-1,'=A-1,Architectural,A,—,,2026-06-02,Design: 75%");
  });
});
