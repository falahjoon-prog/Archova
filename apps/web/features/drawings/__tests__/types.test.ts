import { describe, expect, it } from 'vitest';
import { disciplineLabel } from '../lib/types';

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
