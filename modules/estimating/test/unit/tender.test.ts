import { describe, expect, it } from 'vitest';
import {
  canSeePackage,
  fromCents,
  gstOn,
  lowestQuote,
  nextPackageStatus,
  quoteTotals,
  subcontractSov,
  toCents,
} from '../../src/domain/tender';

describe('money', () => {
  it('converts decimals to cents and back without float error', () => {
    expect(toCents('12.3')).toBe(1230);
    expect(toCents('0.07')).toBe(7);
    expect(toCents('-4.50')).toBe(-450);
    expect(fromCents(1230)).toBe('12.30');
    expect(fromCents(-5)).toBe('-0.05');
    expect(() => toCents('1.234')).toThrow();
    expect(() => toCents('abc')).toThrow();
  });
  it('sums lines and adds 10% GST rounded half up', () => {
    expect(quoteTotals(['0.10', '0.20', '0.05'])).toEqual({ totalExGst: '0.35', gst: '0.04' });
    expect(gstOn(1050)).toBe(105);
    expect(quoteTotals(['4120.00', '7980.00'])).toEqual({ totalExGst: '12100.00', gst: '1210.00' });
  });
});

describe('package lifecycle', () => {
  it('sends a draft, closes and reopens, and cancels before award', () => {
    expect(nextPackageStatus('draft', 'send')).toBe('out_to_tender');
    expect(nextPackageStatus('out_to_tender', 'close')).toBe('closed');
    expect(nextPackageStatus('closed', 'reopen')).toBe('out_to_tender');
    expect(nextPackageStatus('draft', 'close')).toBeNull();
    expect(nextPackageStatus('awarded', 'cancel')).toBeNull();
  });
});

describe('lowestQuote', () => {
  const q = (id: string, status: string, totalExGst: string) => ({ id, status, totalExGst });
  it('counts confirmed quotes only, after allowances', () => {
    const quotes = [
      q('a', 'confirmed', '100.00'),
      q('b', 'confirmed', '120.00'),
      q('c', 'superseded', '1.00'),
    ];
    expect(lowestQuote(quotes, {})).toBe('a');
    expect(lowestQuote(quotes, { 'a:waterproof': '30.00' })).toBe('b');
    expect(lowestQuote([q('x', 'ready_to_review', '1.00')], {})).toBeNull();
  });
});

describe('canSeePackage (EST-AC3)', () => {
  it('shows builder staff everything and invited companies anything past draft', () => {
    const staff = { isInternal: true, companyId: 'own' };
    const sub = { isInternal: false, companyId: 'tiler' };
    expect(canSeePackage({ status: 'draft' }, staff, [])).toBe(true);
    expect(canSeePackage({ status: 'out_to_tender' }, sub, ['tiler'])).toBe(true);
    expect(canSeePackage({ status: 'draft' }, sub, ['tiler'])).toBe(false);
    expect(canSeePackage({ status: 'out_to_tender' }, sub, ['other'])).toBe(false);
  });
});

describe('subcontractSov', () => {
  it('follows the quote lines when they add up to the total', () => {
    expect(
      subcontractSov(
        [
          { description: 'Floor', amount: '6000.00' },
          { description: 'Wall', amount: '5000.50' },
        ],
        '11000.50',
        'Tiling',
      ),
    ).toEqual([
      { code: '1', description: 'Floor', value: '6000.00' },
      { code: '2', description: 'Wall', value: '5000.50' },
    ]);
  });

  it('uses one item for the whole price when the lines do not add up or there are none', () => {
    const one = [{ code: '1', description: 'Tiling', value: '11000.00' }];
    expect(subcontractSov([{ description: 'Floor', amount: '6000' }], '11000', 'Tiling')).toEqual(
      one,
    );
    expect(subcontractSov([], '11000.00', 'Tiling')).toEqual(one);
  });
});
