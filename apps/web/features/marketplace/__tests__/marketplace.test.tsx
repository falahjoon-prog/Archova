// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { MarketplaceScreen } = await import('../screens/MarketplaceScreen');

const C = '/v1/orgs/{orgId}/integrations/catalogue';
const entry = (over: Record<string, unknown>) => ({
  key: 'xero',
  name: 'Xero',
  category: 'accounting',
  summary: 'Send claims.',
  status: 'available',
  detail: null,
  manage: 'accounting',
  ...over,
});

beforeEach(() => fake.reset());

describe('MarketplaceScreen', () => {
  it('groups connectors and links each openable one to its settings screen', async () => {
    fake.on('GET', C, () => ({
      data: [
        entry({ status: 'connected' }),
        entry({ key: 'google', name: 'Google Drive', category: 'files', manage: 'folders' }),
      ],
    }));
    renderInProject(<MarketplaceScreen />);
    expect(await screen.findByRole('heading', { name: 'Accounting' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Files and drawings' })).toBeTruthy();
    const manage = screen.getByRole('link', { name: 'Manage Xero' });
    expect(manage.getAttribute('href')).toBe('/acme/settings/accounting');
    const setUp = screen.getByRole('link', { name: 'Set up Google Drive' });
    expect(setUp.getAttribute('href')).toBe('/acme/settings/folders');
  });

  it('shows problems, roadmap entries and unconfigured providers without a link', async () => {
    fake.on('GET', C, () => ({
      data: [
        entry({ status: 'needs_attention', detail: 'Needs reconnecting.' }),
        entry({ key: 'myob', name: 'MYOB Business', status: 'not_configured' }),
        entry({
          key: 'zapier',
          name: 'Zapier',
          category: 'developer',
          status: 'coming_soon',
          manage: null,
        }),
      ],
    }));
    renderInProject(<MarketplaceScreen />);
    expect(await screen.findByText('Needs reconnecting.')).toBeTruthy();
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /MYOB/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Zapier/ })).toBeNull();
  });
});
