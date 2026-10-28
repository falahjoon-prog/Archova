import { describe, expect, it } from 'vitest';
import { levelsFor } from '../../src/application/tiles';

describe('levelsFor', () => {
  it('has one level when the sheet fits a tile and adds one per doubling', () => {
    expect(levelsFor(200, 100)).toBe(1);
    expect(levelsFor(256, 256)).toBe(1);
    expect(levelsFor(257, 100)).toBe(2);
    expect(levelsFor(512, 300)).toBe(2);
    expect(levelsFor(513, 300)).toBe(3);
    expect(levelsFor(14000, 9900)).toBe(7);
  });
});
