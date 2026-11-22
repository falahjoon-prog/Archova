import { describe, expect, it } from 'vitest';
import { pickBanner } from '../lib/banner';
import type { PublicProductUpdate } from '../data/api';

const u = (id: string, banner: boolean): PublicProductUpdate => ({
  id,
  title: id,
  summary: 's',
  body: '',
  kind: 'feature',
  banner,
  publishedAt: '2026-11-22T00:00:00Z',
});

describe('pickBanner', () => {
  it('takes the newest banner update', () => {
    expect(pickBanner([u('a', false), u('b', true), u('c', true)], [])?.id).toBe('b');
  });
  it('skips dismissed ones and falls back to the next', () => {
    expect(pickBanner([u('b', true), u('c', true)], ['b'])?.id).toBe('c');
  });
  it('returns null when nothing qualifies', () => {
    expect(pickBanner([u('a', false)], [])).toBeNull();
    expect(pickBanner([u('a', true)], ['a'])).toBeNull();
  });
});
