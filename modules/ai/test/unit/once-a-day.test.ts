import { describe, expect, it, vi } from 'vitest';
import { createOnceADay } from '../../src/application/once-a-day';

const ORG = '0192f0a0-0000-7000-8000-000000000001';
const OTHER = '0192f0a0-0000-7000-8000-000000000002';

/** A Redis that keeps keys set with NX, like the real one. */
function fakeRedis() {
  const keys = new Map<string, number>();
  const set = vi.fn(async (key: string, _v: string, _ex: string, ttl: number, _nx: string) => {
    if (keys.has(key)) return null;
    keys.set(key, ttl);
    return 'OK';
  });
  return { set: set as never, calls: set, keys };
}

describe.each([
  ['without Redis', () => createOnceADay(null)],
  ['with Redis', () => createOnceADay(fakeRedis())],
])('once a day %s', (_name, make) => {
  it('is true the first time for an org, limit and day, and false after', async () => {
    const once = make();
    expect(await once.first(ORG, 'embed.document', 'day-1')).toBe(true);
    expect(await once.first(ORG, 'embed.document', 'day-1')).toBe(false);
    expect(await once.first(ORG, 'embed.document', 'day-1')).toBe(false);
  });

  it('counts each org, each limit and each day apart', async () => {
    const once = make();
    expect(await once.first(ORG, 'embed.document', 'day-1')).toBe(true);
    expect(await once.first(OTHER, 'embed.document', 'day-1')).toBe(true);
    expect(await once.first(ORG, 'ocr.page', 'day-1')).toBe(true);
    expect(await once.first(ORG, 'embed.document', 'day-2')).toBe(true);
  });
});

describe('once a day in Redis', () => {
  it('keeps the marker under the org, for longer than a day, so it expires by itself', async () => {
    const redis = fakeRedis();
    await createOnceADay(redis).first(ORG, 'embed.document', 'day-1');
    expect([...redis.keys]).toEqual([[`t:${ORG}:ai:once:embed.document:day-1`, 36 * 3600]]);
  });

  it('says it again rather than failing when Redis is down', async () => {
    const down = createOnceADay({
      set: (async () => {
        throw new Error('ECONNREFUSED');
      }) as never,
    });
    expect(await down.first(ORG, 'embed.document', 'day-1')).toBe(true);
    expect(await down.first(ORG, 'embed.document', 'day-1')).toBe(true);
  });
});
