import { describe, expect, it } from 'vitest';
import { isSignedMoney, revisedOf, signedCents, totalsOf } from '../../src/domain/budget';

const line = (o: string, a: string, c = '0.00', x = '0.00', f = '0.00') => ({
  original: o,
  approvedChanges: a,
  committed: c,
  actual: x,
  forecastToComplete: f,
});

describe('budget arithmetic', () => {
  it('reads signed money in whole cents', () => {
    expect(signedCents('-250.50')).toBe(-25050);
    expect(signedCents('12')).toBe(1200);
    expect(isSignedMoney('-1.5')).toBe(true);
    expect(isSignedMoney('1.555')).toBe(false);
    expect(isSignedMoney('--1')).toBe(false);
  });

  it('revises a line by its approved changes, up or down', () => {
    expect(revisedOf(line('1000.00', '250.25'))).toBe('1250.25');
    expect(revisedOf(line('1000.00', '-400.10'))).toBe('599.90');
  });

  it('totals without float drift', () => {
    const t = totalsOf([line('0.10', '0.00', '0.05'), line('0.20', '-0.05', '0.10')]);
    expect(t).toMatchObject({
      original: '0.30',
      approvedChanges: '-0.05',
      revised: '0.25',
      committed: '0.15',
    });
  });
});
