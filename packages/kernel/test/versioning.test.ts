import { describe, expect, it } from 'vitest';
import {
  AppError,
  decodeCursor,
  encodeCursor,
  etag,
  parseIfMatch,
  tenantKey,
  toPage,
} from '../src';

describe('If-Match', () => {
  it('round-trips with etag()', () => {
    expect(parseIfMatch(etag(7))).toBe(7);
    expect(parseIfMatch('W/"3"')).toBe(3);
  });
  it('requires the header (428) and rejects garbage (412)', () => {
    expect(() => parseIfMatch(undefined)).toThrow(AppError);
    try {
      parseIfMatch(undefined);
    } catch (e) {
      expect((e as AppError).status).toBe(428);
    }
    try {
      parseIfMatch('nope');
    } catch (e) {
      expect((e as AppError).status).toBe(412);
    }
  });
});

describe('cursors', () => {
  it('round-trips and pages', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = toPage(rows, 2, (r) => ({ id: r.id }));
    expect(page.data).toHaveLength(2);
    expect(decodeCursor(page.nextCursor!)).toEqual({ id: 'b' });
    expect(toPage(rows, 5, (r) => ({ id: r.id })).nextCursor).toBeNull();
    expect(decodeCursor(encodeCursor({ id: 'x', n: 1 }))).toEqual({ id: 'x', n: 1 });
  });
  it('rejects malformed cursors with a 422', () => {
    expect(() => decodeCursor('!!!')).toThrow(AppError);
  });
});

describe('tenantKey', () => {
  it('prefixes with the org', () => {
    expect(tenantKey('o1', 'perm', 'u1')).toBe('t:o1:perm:u1');
  });
});
