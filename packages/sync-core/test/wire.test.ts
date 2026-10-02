import { describe, expect, it } from 'vitest';
import {
  backoffDelay,
  classifyFailure,
  formatScopesParam,
  ORG_SCOPE,
  parseRetryAfter,
  parseScopeKey,
  projectScope,
  scopeKey,
  SyncHttpError,
} from '../src';

describe('scopes', () => {
  it('formats the scopes parameter as the API expects', () => {
    expect(
      formatScopesParam([
        projectScope('prj_a', 'diary'),
        projectScope('prj_b', 'defects'),
        projectScope('prj_a', 'defects'),
        ORG_SCOPE,
      ]),
    ).toBe('project:prj_a:diary,defects;project:prj_b:defects;org');
  });

  it('round-trips scope keys', () => {
    for (const s of [projectScope('prj_a', 'diary'), ORG_SCOPE]) {
      expect(parseScopeKey(scopeKey(s))).toEqual(s);
    }
    expect(() => parseScopeKey('project:a')).toThrow();
  });
});

describe('failures and backoff', () => {
  it('classifies failures', () => {
    expect(classifyFailure(new TypeError('Network request failed'))).toBe('retry');
    expect(classifyFailure(new SyncHttpError(0))).toBe('retry');
    expect(classifyFailure(new SyncHttpError(429))).toBe('retry');
    expect(classifyFailure(new SyncHttpError(503))).toBe('retry');
    expect(classifyFailure(new SyncHttpError(401))).toBe('auth');
    expect(classifyFailure(new SyncHttpError(426))).toBe('upgrade');
    expect(classifyFailure(new SyncHttpError(400))).toBe('fatal');
  });

  it('parses Retry-After as seconds or a date', () => {
    const now = Date.parse('2026-10-02T09:00:00Z');
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter('Fri, 02 Oct 2026 09:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it('caps the backoff and never undercuts Retry-After', () => {
    const opts = { baseMs: 1_000, capMs: 10_000 };
    expect(backoffDelay(1, () => 0.999, opts)).toBe(999);
    expect(backoffDelay(10, () => 0.999, opts)).toBe(9_990);
    expect(backoffDelay(1, () => 0, opts, 5_000)).toBe(5_000);
  });
});
