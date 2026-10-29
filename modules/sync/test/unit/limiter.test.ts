import { describe, expect, it } from 'vitest';
import { DRAIN_LIMITS, createLimiter } from '../../src/application/drain';

describe('drain limiter', () => {
  it('does not grow without bound when every request uses a different key', () => {
    const limiter = createLimiter(20);
    for (let i = 0; i < DRAIN_LIMITS.limiterEntries * 2; i += 1) limiter.hit(`ip-${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(DRAIN_LIMITS.limiterEntries);
  });

  it('refuses a key after its limit and keeps counting per key', () => {
    const limiter = createLimiter(3);
    expect([1, 2, 3, 4].map(() => limiter.hit('a'))).toEqual([true, true, true, false]);
    expect(limiter.over('a')).toBe(true);
    expect(limiter.over('b')).toBe(false);
  });
});
