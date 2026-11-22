import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProductUpdates, paragraphs } from './product-updates';

describe('product updates', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('splits plain text into paragraphs', () => {
    expect(paragraphs('One.\n\n\nTwo.\n\n  ')).toEqual(['One.', 'Two.']);
    expect(paragraphs('')).toEqual([]);
  });

  it('is empty without an API address', async () => {
    vi.stubEnv('SITE_API_URL', '');
    expect(await getProductUpdates()).toEqual([]);
  });

  it('is empty when the API fails', async () => {
    vi.stubEnv('SITE_API_URL', 'http://api.test');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await getProductUpdates()).toEqual([]);
  });

  it('returns the published items', async () => {
    vi.stubEnv('SITE_API_URL', 'http://api.test');
    const items = [
      {
        id: '1',
        title: 'T',
        summary: 'S',
        body: '',
        kind: 'feature',
        publishedAt: '2026-11-22T00:00:00Z',
      },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items }) }));
    expect(await getProductUpdates()).toEqual(items);
  });
});
