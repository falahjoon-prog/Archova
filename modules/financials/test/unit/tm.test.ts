import { describe, expect, it } from 'vitest';
import {
  contentHash,
  isQuantity,
  lineCents,
  statusAfterSigning,
  totalCents,
  totalsByKind,
  type TicketContent,
} from '../../src/domain/tm';

const base: TicketContent = {
  number: 3,
  title: 'Extra excavation',
  description: null,
  workDate: '2026-11-05',
  location: 'Level 2',
  contractor: 'Acme',
  instructedBy: 'S. Lee',
  lines: [{ kind: 'labour', description: 'Dan', quantity: '8.00', unit: 'hr', rate: '85.00' }],
};

describe('T&M ticket maths', () => {
  it('prices a line in whole cents, half up', () => {
    expect(lineCents('8.00', '85.00')).toBe(68000);
    expect(lineCents('1.50', '33.33')).toBe(5000); // 49.995 rounds up
    expect(lineCents('0.25', '0.01')).toBe(0);
  });
  it('totals and splits by kind', () => {
    const lines = [
      { kind: 'labour' as const, amount: '680.00' },
      { kind: 'equipment' as const, amount: '120.50' },
      { kind: 'labour' as const, amount: '10.00' },
    ];
    expect(totalCents(lines)).toBe(81050);
    expect(totalsByKind(lines)).toEqual({ labour: 69000, equipment: 12050, material: 0 });
  });
  it('accepts positive quantities of up to two decimals only', () => {
    expect(isQuantity('1')).toBe(true);
    expect(isQuantity('0.25')).toBe(true);
    expect(isQuantity('0')).toBe(false);
    expect(isQuantity('0.00')).toBe(false);
    expect(isQuantity('1.234')).toBe(false);
    expect(isQuantity('-1')).toBe(false);
    expect(isQuantity('1000000.00')).toBe(true);
    expect(isQuantity('1000000.01')).toBe(false);
  });
});

describe('T&M signing', () => {
  it('is signed only once both roles have signed', () => {
    expect(statusAfterSigning(['contractor'])).toBe('part_signed');
    expect(statusAfterSigning(['principal_rep'])).toBe('part_signed');
    expect(statusAfterSigning(['contractor', 'principal_rep'])).toBe('signed');
  });
  it('hashes content so any change shows', () => {
    const h = contentHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash({ ...base })).toBe(h);
    expect(contentHash({ ...base, title: 'Extra excavation!' })).not.toBe(h);
    expect(contentHash({ ...base, lines: [{ ...base.lines[0]!, rate: '85.01' }] })).not.toBe(h);
  });
});
