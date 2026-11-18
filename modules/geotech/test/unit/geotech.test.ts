import { describe, expect, it } from 'vitest';
import {
  evaluateTest,
  geotechFlags,
  investigationLabel,
  summariseEarthworks,
} from '../../src/domain/geotech';

describe('evaluateTest', () => {
  it('has no opinion without limits', () => expect(evaluateTest(12, null, null)).toBe('no_spec'));
  it('treats limits as inclusive', () => {
    expect(evaluateTest(15, 15, null)).toBe('pass');
    expect(evaluateTest(98, 95, 100)).toBe('pass');
    expect(evaluateTest(100, 95, 100)).toBe('pass');
  });
  it('fails below the minimum or above the maximum', () => {
    expect(evaluateTest(14.9, 15, null)).toBe('fail');
    expect(evaluateTest(101, 95, 100)).toBe('fail');
    expect(evaluateTest(5, null, 4)).toBe('fail');
  });
});

describe('summariseEarthworks', () => {
  const rows = [
    { zone: 'Lot B', kind: 'cut' as const, volumeM3: 400 },
    { zone: 'Lot A', kind: 'cut' as const, volumeM3: 1200.5 },
    { zone: 'Lot A', kind: 'fill' as const, volumeM3: 900 },
    { zone: 'Lot A', kind: 'export' as const, volumeM3: 100 },
    { zone: 'Lot B', kind: 'fill' as const, volumeM3: 700 },
    { zone: 'Lot B', kind: 'import' as const, volumeM3: 100 },
  ];
  it('totals by zone and balances cut + import - fill - export', () => {
    const { zones, total } = summariseEarthworks(rows);
    expect(zones.map((z) => [z.zone, z.balance])).toEqual([
      ['Lot A', 200.5],
      ['Lot B', -200],
    ]);
    expect(total).toEqual({ cut: 1600.5, fill: 1600, imported: 100, exported: 100, balance: 0.5 });
  });
  it('is empty for no entries', () =>
    expect(summariseEarthworks([])).toEqual({
      zones: [],
      total: { cut: 0, fill: 0, imported: 0, exported: 0, balance: 0 },
    }));
});

describe('geotechFlags', () => {
  it('raises failed tests, short zones and missing reports, and stays quiet otherwise', () => {
    const flags = geotechFlags({
      failedTests: [{ id: 't1', kind: 'cbr', sampleRef: 'S-3', zone: 'Lot A' }],
      investigationsWithoutReport: [{ id: 'i1', number: 2, title: 'BH2' }],
      zones: [
        { zone: 'Lot B', cut: 400, fill: 700, imported: 100, exported: 0, balance: -200 },
        { zone: 'Lot C', cut: 0, fill: 0, imported: 0, exported: 0, balance: 0 },
      ],
    });
    expect(flags.map((f) => f.kind)).toEqual(['failed_test', 'short_of_fill', 'no_report']);
    expect(flags[1]!.detail).toContain('200 m³');
    expect(geotechFlags({ failedTests: [], investigationsWithoutReport: [], zones: [] })).toEqual(
      [],
    );
  });
});

it('numbers investigations GEO-0001', () => expect(investigationLabel(7)).toBe('GEO-0007'));
