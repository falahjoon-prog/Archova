// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const perm = vi.hoisted(() => ({ level: 'admin' }));
vi.mock('@/features/projects', () => ({
  useProjectPermissions: () => ({
    data: { orgRole: null, toolLevels: { payment_claims: perm.level } },
  }),
}));
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { CostForecastScreen } = await import('../screens/CostForecastScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const adjustment = {
  id: 'fca_1',
  contractId: null,
  category: 'unawarded_work',
  label: 'Landscaping',
  note: null,
  amount: '25000.00',
  createdAt: '2026-11-05T00:00:00Z',
};
const forecast = (over: Record<string, unknown> = {}) => ({
  revenue: '500000.00',
  billedToDate: '0.00',
  pendingRevenueVariations: '0.00',
  committed: '100000.00',
  claimedToDate: '30000.00',
  costToComplete: '70000.00',
  projectAdjustments: '25000.00',
  forecastFinalCost: '125000.00',
  pendingCostVariations: '0.00',
  forecastMargin: '375000.00',
  forecastMarginPct: '75.00',
  commitments: [
    {
      contractId: 'cnt_1',
      number: 1,
      title: 'Electrical',
      committed: '100000.00',
      claimedToDate: '30000.00',
      costToComplete: '70000.00',
      adjustments: '0.00',
      forecastFinal: '100000.00',
      pendingVariations: '0.00',
    },
  ],
  adjustments: [adjustment],
  ...over,
});

beforeEach(() => {
  fake.reset();
  perm.level = 'admin';
});

describe('CostForecastScreen', () => {
  it('shows cost to complete, final cost and margin', async () => {
    fake.on('GET', `${P}/cost-forecast`, () => forecast());
    renderInProject(<CostForecastScreen />);
    expect(await screen.findByText('Forecast final cost')).toBeTruthy();
    expect(screen.getByText('75.00%')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Electrical/ })).toBeTruthy();
  });

  it('warns when the project is forecast to lose money', async () => {
    fake.on('GET', `${P}/cost-forecast`, () =>
      forecast({ forecastMargin: '-20000.00', forecastMarginPct: '-4.00' }),
    );
    renderInProject(<CostForecastScreen />);
    expect(await screen.findByText(/forecast to finish at a loss/)).toBeTruthy();
  });

  it('refuses a zero amount and sends a saving as a negative', async () => {
    const posts: unknown[] = [];
    fake.on('GET', `${P}/cost-forecast`, () => forecast());
    fake.on('POST', `${P}/cost-forecast/adjustments`, (init: { body?: unknown }) => {
      posts.push(init.body);
      return adjustment;
    });
    renderInProject(<CostForecastScreen />);
    await screen.findByText('Forecast final cost');
    const user = userEvent.setup();
    await enterText(user, screen.getByLabelText(/What is it for/), 'Cheaper tiles');
    await enterText(user, screen.getByLabelText(/Amount \(ex GST\)/), '0');
    await user.click(screen.getByRole('button', { name: 'Add adjustment' }));
    expect(await screen.findByText(/not zero/)).toBeTruthy();
    expect(posts).toHaveLength(0);
    await user.clear(screen.getByLabelText(/Amount \(ex GST\)/));
    await enterText(user, screen.getByLabelText(/Amount \(ex GST\)/), '-3000');
    await user.click(screen.getByRole('button', { name: 'Add adjustment' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ category: 'unawarded_work', amount: '-3000' });
  });

  it('keeps the margin from anyone below admin', async () => {
    perm.level = 'standard';
    renderInProject(<CostForecastScreen />);
    expect(await screen.findByText(/only project administrators/)).toBeTruthy();
  });
});
