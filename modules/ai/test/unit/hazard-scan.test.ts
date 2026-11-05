import { describe, expect, it } from 'vitest';
import {
  hazardPatterns,
  reviewHazardScan,
  soften,
  type PatternSignal,
} from '../../src/domain/hazard-scan';

const sig = (
  category: string,
  observation: string,
  confidence: 'low' | 'medium' | 'high' = 'medium',
) => ({
  category: category as never,
  observation,
  confidence,
});

describe('reviewHazardScan', () => {
  it('drops wording that judges and counts it', () => {
    const r = reviewHazardScan(
      {
        signals: [
          sig('ppe', 'The contractor is in breach of the WHS Act.'),
          sig('housekeeping', 'The photo shows offcuts across the walkway.'),
          sig('edge_protection', 'This is illegal and must be fixed.'),
        ],
        photoUnclear: false,
      },
      { note: '' },
    );
    expect(r.signals.map((s) => s.category)).toEqual(['housekeeping']);
    expect(r.dropped).toBe(2);
  });

  it('never keeps a name for a person', () => {
    const r = reviewHazardScan(
      {
        signals: [
          sig('ppe', 'A worker named Dave has no hard hat.'),
          sig('ppe', 'Mr Smith is near the edge.'),
          sig('ppe', 'The photo shows a worker near the edge.'),
        ],
        photoUnclear: false,
      },
      { note: '' },
    );
    expect(r.signals).toHaveLength(1);
    expect(r.dropped).toBe(2);
  });

  it('keeps PPE as what the photo suggests, never as a fact about a person', () => {
    expect(soften('One worker is not wearing a hard hat.')).toBe(
      'One worker appears not to be wearing a hard hat.',
    );
    expect(soften('Hi-vis is not worn.')).toBe('Hi-vis appears not to be worn.');
  });

  it('removes repeats, puts the surest first and caps the list', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      sig('other', `The photo shows item ${i}.`, 'low'),
    );
    const r = reviewHazardScan(
      {
        signals: [
          sig('ppe', 'The photo shows a worker.', 'low'),
          sig('ppe', 'the photo shows a worker', 'low'),
          sig('edge_protection', 'The photo shows an open edge.', 'high'),
          ...many,
        ],
        photoUnclear: false,
      },
      { note: '' },
    );
    expect(r.signals).toHaveLength(8);
    expect(r.signals[0]!.category).toBe('edge_protection');
    expect(r.signals.filter((s) => s.category === 'ppe')).toHaveLength(1);
  });

  it('lists numbers the person did not type', () => {
    const r = reviewHazardScan(
      {
        signals: [sig('other', 'A sign reads 40 on the left, 12 on the right.')],
        photoUnclear: false,
      },
      { note: 'speed 40' },
    );
    expect(r.unsupportedNumbers).toEqual(['12']);
  });
});

describe('hazardPatterns', () => {
  const now = new Date('2026-11-05T00:00:00Z');
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const row = (
    category: string,
    status: PatternSignal['status'],
    photoId: string,
    daysAgo: number,
  ): PatternSignal => ({
    category,
    status,
    photoId,
    createdAt: day(daysAgo),
  });

  it('makes a pattern only from confirmed signals across more than one photo', () => {
    const p = hazardPatterns(
      [
        row('ppe', 'confirmed', 'a', 2),
        row('ppe', 'confirmed', 'b', 3),
        row('ppe', 'confirmed', 'b', 4),
        row('edge_protection', 'confirmed', 'a', 2),
        row('edge_protection', 'confirmed', 'a', 3),
        row('edge_protection', 'confirmed', 'a', 4),
        row('housekeeping', 'open', 'c', 1),
        row('housekeeping', 'dismissed', 'd', 1),
      ],
      { now, days: 30 },
    );
    const by = Object.fromEntries(p.map((x) => [x.category, x]));
    expect(by.ppe!.isPattern).toBe(true);
    expect(by.ppe!.photos).toBe(2);
    expect(by.edge_protection!.isPattern).toBe(false);
    expect(by.housekeeping).toMatchObject({
      open: 1,
      dismissed: 1,
      confirmed: 0,
      isPattern: false,
    });
    expect(p[0]!.category).toBe('ppe');
  });

  it('ignores signals outside the window and reads the trend', () => {
    const p = hazardPatterns(
      [
        row('ppe', 'confirmed', 'a', 1),
        row('ppe', 'confirmed', 'b', 2),
        row('ppe', 'confirmed', 'c', 20),
        row('ppe', 'confirmed', 'd', 60),
      ],
      { now, days: 30 },
    );
    expect(p[0]).toMatchObject({ confirmed: 3, trend: 'rising' });
  });
});
