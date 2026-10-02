import { describe, expect, it } from 'vitest';
import { compareRevisions } from '../../src/domain/revisions';

describe('compareRevisions', () => {
  it.each([
    ['A', 'B', -1],
    ['B', 'A', 1],
    ['Z', 'AA', -1],
    ['C', '0', -1],
    ['0', '1', -1],
    ['9', '10', -1],
    ['P3', 'C1', -1],
    ['P2', 'P10', -1],
    ['C2', 'C1', 1],
    ['b', 'B', 0],
    ['01', '1', 0],
  ])('%s vs %s', (a, b, sign) => {
    expect(Math.sign(compareRevisions(a, b))).toBe(sign === 0 ? 0 : sign);
  });

  it('places unrecognised schemes after the known ones and orders them as text', () => {
    expect(compareRevisions('5', 'REV-X')).toBeLessThan(0);
    expect(compareRevisions('REV-A', 'REV-B')).toBeLessThan(0);
  });
});
