import { describe, expect, it } from 'vitest';
import { buildCatalogue, type CatalogueInput } from '../../src/domain/catalogue';

const base: CatalogueInput = {
  accountingAvailable: ['xero'],
  folderAvailable: ['google'],
  accounting: new Map(),
  folders: new Map(),
  activeWebhooks: 0,
};
const by = (input: CatalogueInput, key: string) =>
  buildCatalogue(input).find((e) => e.key === key)!;

describe('buildCatalogue', () => {
  it('lists unconfigured providers as not configured and configured ones as available', () => {
    expect(by(base, 'xero').status).toBe('available');
    expect(by(base, 'myob').status).toBe('not_configured');
    expect(by(base, 'm365').status).toBe('not_configured');
    expect(by(base, 'google').status).toBe('available');
  });

  it('maps connection state', () => {
    const input = {
      ...base,
      accounting: new Map([['xero', { status: 'active' as const, lastError: null }]]),
      folders: new Map([['google', { status: 'error' as const, lastError: 'Token revoked.' }]]),
    };
    expect(by(input, 'xero').status).toBe('connected');
    const g = by(input, 'google');
    expect(g.status).toBe('needs_attention');
    expect(g.detail).toBe('Token revoked.');
  });

  it('keeps a pending sign-in visible even when the provider is no longer configured', () => {
    const input = {
      ...base,
      accounting: new Map([['myob', { status: 'needs_target' as const, lastError: null }]]),
    };
    expect(by(input, 'myob').status).toBe('needs_attention');
  });

  it('counts the API as connected once a webhook is active and never opens roadmap entries', () => {
    expect(by({ ...base, activeWebhooks: 2 }, 'api').detail).toBe('2 webhook endpoints active.');
    expect(by(base, 'api').status).toBe('available');
    const z = by(base, 'zapier');
    expect(z.status).toBe('coming_soon');
    expect(z.manage).toBeNull();
  });
});
