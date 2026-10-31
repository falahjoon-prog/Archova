import { describe, expect, it } from 'vitest';
import {
  computeSheet,
  lineAmountCents,
  rateOn,
  scaled,
  sumQuantities,
  type SheetLine,
} from '../../src/domain/estimate';

const item = (
  id: string,
  quantity: string | null,
  rate: string | null,
  parentId: string | null = null,
) => ({ id, parentId, kind: 'item', quantity, rate }) satisfies SheetLine;
const settings = {
  contingencyPct: '0',
  marginPct: '0',
  marginBasis: 'markup',
  gstPct: '10',
} as const;

describe('estimate arithmetic', () => {
  it('multiplies exactly and rounds half up to the cent', () => {
    expect(lineAmountCents('12.500', '3.33')).toBe(4163n); // 41.625 → 41.63
    expect(lineAmountCents('0.001', '0.50')).toBe(0n);
    expect(lineAmountCents('1000000000.000', '999999.99')).toBe(99999999000000000n);
    expect(lineAmountCents(null, '5.00')).toBeNull();
    expect(lineAmountCents('2.000', null)).toBeNull();
  });

  it('refuses numbers that are not plain decimals', () => {
    expect(scaled('1.2345', 3)).toBeNull();
    expect(scaled('1.2300', 3)).toBe(1230n);
    expect(scaled('-1', 3)).toBeNull();
    expect(scaled('1e3', 3)).toBeNull();
  });

  it('adds contingency, then margin on the cost, then GST', () => {
    const t = computeSheet([item('a', '100.000', '10.00')], {
      contingencyPct: '5',
      marginPct: '12.5',
      marginBasis: 'markup',
      gstPct: '10',
    });
    expect(t.subtotal).toBe('1000.00');
    expect(t.contingency).toBe('50.00');
    expect(t.margin).toBe('131.25'); // 12.5% of 1050
    expect(t.totalExGst).toBe('1181.25');
    expect(t.gst).toBe('118.13'); // 118.125 rounds up
    expect(t.totalIncGst).toBe('1299.38');
  });

  it('takes margin as a share of the selling price when asked', () => {
    const t = computeSheet([item('a', '1.000', '800.00')], {
      ...settings,
      marginPct: '20',
      marginBasis: 'margin',
    });
    expect(t.margin).toBe('200.00'); // 800 / (1 - 0.2) = 1000
    expect(t.totalExGst).toBe('1000.00');
  });

  it('leaves unpriced lines out and counts them, never inventing a rate', () => {
    const lines: SheetLine[] = [
      { id: 's', parentId: null, kind: 'section', quantity: null, rate: null },
      item('a', '2.000', '50.00', 's'),
      item('b', '4.000', null, 's'),
      item('c', null, '9.00'),
    ];
    const t = computeSheet(lines, settings);
    expect(t.missingRates).toBe(2);
    expect(t.amounts).toEqual({ a: '100.00' });
    expect(t.sections).toEqual({ s: '100.00' });
    expect(t.totalExGst).toBe('100.00');
    expect(t.gst).toBe('10.00');
  });

  it('sums quantities in thousandths', () => {
    expect(sumQuantities(['0.100', '0.200'])).toBe('0.300');
    expect(sumQuantities([])).toBe('0.000');
  });
});

describe('rate in force', () => {
  const rates = [
    { rate: '40.00', region: null, effectiveFrom: '2026-01-01' },
    { rate: '45.00', region: null, effectiveFrom: '2026-07-01' },
    { rate: '52.00', region: 'Regional QLD', effectiveFrom: '2026-03-01' },
  ];
  it('uses the latest rate on or before the date', () => {
    expect(rateOn(rates, '2026-06-30', null)?.rate).toBe('40.00');
    expect(rateOn(rates, '2026-07-01', null)?.rate).toBe('45.00');
    expect(rateOn(rates, '2025-12-31', null)).toBeNull();
  });
  it('prefers the estimate region, ignoring other regions', () => {
    expect(rateOn(rates, '2026-08-01', 'regional qld')?.rate).toBe('52.00');
    expect(rateOn(rates, '2026-08-01', 'Perth')?.rate).toBe('45.00');
    expect(rateOn(rates, '2026-02-01', 'Regional QLD')?.rate).toBe('40.00');
  });
});
