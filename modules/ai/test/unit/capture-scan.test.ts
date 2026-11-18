import { describe, expect, it } from 'vitest';
import { reviewCaptureScan } from '../../src/domain/capture-scan';

const obs = (
  category: string,
  observation: string,
  confidence: 'low' | 'medium' | 'high' = 'medium',
) => ({ category: category as never, observation, confidence });

describe('reviewCaptureScan', () => {
  it('drops wording that judges and counts it', () => {
    const r = reviewCaptureScan(
      {
        observations: [
          obs('fire_stopping', 'The builder is in breach of the NCC.'),
          obs('defect', 'The still shows a crack in the wall by the lift.'),
          obs('incomplete_work', 'This is non-compliant and must be fixed.'),
        ],
        stillUnclear: false,
      },
      { note: '' },
    );
    expect(r.observations.map((o) => o.category)).toEqual(['defect']);
    expect(r.dropped).toBe(2);
  });

  it('never keeps a name for a person', () => {
    const r = reviewCaptureScan(
      {
        observations: [obs('other', 'A worker named Dave is near the riser.')],
        stillUnclear: false,
      },
      { note: '' },
    );
    expect(r.observations).toEqual([]);
    expect(r.dropped).toBe(1);
  });

  it('removes repeats, puts the surest first and caps the list', () => {
    const list = [
      obs('defect', 'The still shows a chip in the tile.', 'medium'),
      obs('defect', 'the still shows a chip in the tile', 'medium'),
      obs('services', 'The still shows a pipe through the wall.', 'high'),
      ...Array.from({ length: 6 }, (_, i) => obs('other', `Marking number ${i} on the floor.`)),
    ];
    const r = reviewCaptureScan({ observations: list, stillUnclear: false }, { note: '' });
    expect(r.observations).toHaveLength(8);
    expect(r.observations[0]!.category).toBe('services');
    expect(r.observations.filter((o) => o.category === 'defect')).toHaveLength(1);
  });

  it('lists numbers the person did not type and passes the unclear flag through', () => {
    const r = reviewCaptureScan(
      { observations: [obs('other', 'A label reads 42 on the door.')], stillUnclear: true },
      { note: 'Level 3' },
    );
    expect(r.unsupportedNumbers).toEqual(['42']);
    expect(r.stillUnclear).toBe(true);
  });
});
