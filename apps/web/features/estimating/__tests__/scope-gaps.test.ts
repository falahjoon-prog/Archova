import { describe, expect, it } from 'vitest';
import { findScopeGaps } from '../lib/scope-gaps';

const ids = (d: string[]) => findScopeGaps(d).map((g) => g.id);

describe('estimate scope gaps', () => {
  it('flags what travels with a slab', () => {
    const got = ids(['Slab on ground 100mm', 'Site preliminaries']);
    expect(got).toEqual(
      expect.arrayContaining(['slab-reo', 'slab-formwork', 'slab-membrane', 'footing-excavation']),
    );
    expect(got).not.toContain('preliminaries');
  });

  it('stays quiet once the related line is there', () => {
    const got = ids([
      'Slab',
      'SL82 mesh reinforcement',
      'Edge formwork',
      'Vapour barrier',
      'Excavation',
      'Preliminaries',
    ]);
    expect(got).toEqual([]);
  });

  it('flags tiling without waterproofing and missing preliminaries', () => {
    expect(ids(['Bathroom wall tiling'])).toEqual(
      expect.arrayContaining(['wet-area', 'preliminaries']),
    );
  });

  it('says nothing about an empty estimate', () => {
    expect(findScopeGaps([])).toEqual([]);
    expect(findScopeGaps(['  '])).toEqual([]);
  });
});
