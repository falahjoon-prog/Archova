// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', async () => {
  const { createQueries } = await import('@archova/query');
  return { ...fake.module, queries: createQueries(fake.module.api as never) };
});

const { fakeProblem } = await import('@/test/fake-api');
const { ClientLinkScreen } = await import('../screens/ClientLinkScreen');

const view = (over = {}) => ({
  project: { name: 'Tower P', fromOrg: 'Acme Builders', timezone: 'Australia/Sydney' },
  progress: {
    title: 'October',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    percentComplete: 35,
    summary: 'Slab poured.',
    publishedAt: '2026-11-01T01:00:00Z',
  },
  milestones: [{ name: 'Lock-up', date: '2026-12-15', status: 'on_track' }],
  updates: [],
  changes: [
    {
      kind: 'variation',
      reference: 'VAR-001',
      title: 'Extra car bays',
      description: '',
      timeImpactDays: 4,
      approvedAt: '2026-11-02T01:00:00Z',
    },
  ],
  photos: [
    {
      caption: 'Level 2 slab',
      url: 'https://files.example/a.jpg',
      addedAt: '2026-11-02T01:00:00Z',
    },
  ],
  expiresAt: '2026-12-18T00:00:00Z',
  ...over,
});

const renderScreen = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ClientLinkScreen token="arl_x" />
    </QueryClientProvider>,
  );

beforeEach(() => fake.reset());

describe('ClientLinkScreen', () => {
  it('shows progress, what is coming up, photos and approved changes without any amounts', async () => {
    fake.on('POST', '/v1/owner-portal-access', () => view());
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Tower P' })).toBeTruthy();
    expect(screen.getByText('35% complete')).toBeTruthy();
    expect(screen.getByText('Lock-up')).toBeTruthy();
    expect(screen.getByText(/VAR-001 Extra car bays/)).toBeTruthy();
    expect(screen.getByText(/adds 4 days/)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Level 2 slab' })).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('says so plainly when the link no longer works', async () => {
    fake.on('POST', '/v1/owner-portal-access', () => fakeProblem(410, 'access_link.invalid'));
    renderScreen();
    expect(await screen.findByText('This link no longer works')).toBeTruthy();
  });
});
