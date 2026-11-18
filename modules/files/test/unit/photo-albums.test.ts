import { describe, expect, it } from 'vitest';
import {
  UNCLASSIFIED_FLAG_AFTER_MS,
  categoryOfModule,
  distanceM,
  needsReview,
  suggestFiling,
  type PhotoFacts,
} from '../../src/domain/photo-albums';

const at = new Date('2026-11-07T01:00:00Z');
const photo = (over: Partial<PhotoFacts>): PhotoFacts => ({
  id: 'p',
  category: 'unclassified',
  refKind: null,
  refId: null,
  uploaderId: 'u1',
  at,
  lat: null,
  lng: null,
  ...over,
});

describe('photo albums', () => {
  it('derives the album from the module a photo was taken in', () => {
    expect(categoryOfModule('diary')).toBe('daily_log');
    expect(categoryOfModule('defects')).toBe('punch_list');
    expect(categoryOfModule('quality')).toBe('inspections');
    expect(categoryOfModule('photos')).toBe('unclassified');
  });

  it('flags only unclassified photos older than 24 hours', () => {
    const now = new Date(at.getTime() + UNCLASSIFIED_FLAG_AFTER_MS);
    expect(needsReview('unclassified', at, now)).toBe(true);
    expect(needsReview('unclassified', at, new Date(now.getTime() - 1))).toBe(false);
    expect(needsReview('punch_list', at, now)).toBe(false);
  });

  it('suggests the album of a filed photo taken within 75 m, closest first', () => {
    const p = photo({ lat: -33.8688, lng: 151.2093 });
    const near = photo({
      id: 'near',
      category: 'punch_list',
      refKind: 'defect',
      refId: 'd1',
      lat: -33.86885,
      lng: 151.20935,
    });
    const nearer = photo({ id: 'nearer', category: 'inspections', lat: -33.86881, lng: 151.20931 });
    const far = photo({ id: 'far', category: 'daily_log', lat: -33.87, lng: 151.21 });
    expect(distanceM(p.lat!, p.lng!, far.lat!, far.lng!)).toBeGreaterThan(75);
    expect(suggestFiling(p, [far, near, nearer])).toMatchObject({
      category: 'inspections',
      basedOnFileId: 'nearer',
      reason: 'same_place',
    });
    expect(suggestFiling(p, [near])).toMatchObject({
      category: 'punch_list',
      refKind: 'defect',
      refId: 'd1',
    });
    expect(suggestFiling(p, [far])).toBeNull();
  });

  it('falls back to the same person within 30 minutes when there is no location', () => {
    const p = photo({});
    const mine = photo({
      id: 'm',
      category: 'daily_log',
      at: new Date(at.getTime() - 10 * 60_000),
    });
    const theirs = photo({ id: 't', category: 'punch_list', uploaderId: 'u2' });
    const old = photo({ id: 'o', category: 'rfis', at: new Date(at.getTime() - 40 * 60_000) });
    expect(suggestFiling(p, [theirs, old, mine])?.category).toBe('daily_log');
    expect(suggestFiling(p, [theirs, old])).toBeNull();
  });

  it('never suggests another unclassified photo', () => {
    expect(suggestFiling(photo({}), [photo({ id: 'x' })])).toBeNull();
  });
});
