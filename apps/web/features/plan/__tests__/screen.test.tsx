// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', async () => {
  const { createQueries } = await import('@archova/query');
  return { ...fake.module, queries: createQueries(fake.module.api as never) };
});

const { PlanScreen } = await import('../screens/PlanScreen');

const E = '/v1/orgs/{orgId}/entitlements';
const ent = (over = {}) => ({
  orgId: 'org_test',
  plan: 'business',
  state: 'active',
  modules: ['platform', 'files', 'documents', 'rfis', 'financials', 'claims', 'ai'],
  limits: { 'limit.seats': 25, 'limit.storage_gb': null },
  ...over,
});

beforeEach(() => fake.reset());

describe('PlanScreen', () => {
  it('shows the plan, what it includes once each, and limits', async () => {
    fake.on('GET', E, () => ent());
    renderInProject(<PlanScreen />);
    expect(await screen.findByText('Business')).toBeTruthy();
    expect(screen.getByText('Documents and drawings')).toBeTruthy();
    expect(screen.getAllByText('Contracts, claims and payment schedules')).toHaveLength(1);
    expect(screen.queryByText('Platform')).toBeNull();
    const table = screen.getByRole('table', { name: 'Limits' });
    expect(within(table).getByText('People')).toBeTruthy();
    expect(within(table).getByText('25')).toBeTruthy();
    expect(within(table).getByText('No limit')).toBeTruthy();
  });

  it('explains a read only account', async () => {
    fake.on('GET', E, () => ent({ state: 'read_only' }));
    renderInProject(<PlanScreen />);
    expect(await screen.findByText(/nothing can be added or changed/)).toBeTruthy();
  });
});
