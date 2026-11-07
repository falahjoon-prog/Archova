// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', async () => {
  const { createQueries } = await import('@archova/query');
  return { ...fake.module, queries: createQueries(fake.module.api as never) };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { SnapshotsScreen } = await import('../screens/SnapshotsScreen');
const { SnapshotDetailScreen } = await import('../screens/SnapshotDetailScreen');
const { compareTotal } = await import('../lib/types');

const LIST = '/v1/orgs/{orgId}/dashboard-snapshots';
const ONE = '/v1/orgs/{orgId}/dashboard-snapshots/{snapshotId}';
const PORTFOLIO = '/v1/orgs/{orgId}/portfolio';

const totals = (over: Record<string, number> = {}) => ({
  projects: 1,
  rfisOpen: 3,
  rfisOverdue: 1,
  defectsOpen: 0,
  defectsOverdue: 0,
  submittalsOpen: 0,
  submittalsOverdue: 0,
  claimsOpen: 0,
  claimsOverdue: 0,
  variationsOpen: 0,
  variationsOverdue: 0,
  incidentsOpen: 0,
  incidentsOverdue: 0,
  programmeOpen: 0,
  programmeOverdue: 0,
  budgetProjects: 0,
  projectsOverBudget: 0,
  budgetRevised: '0.00',
  budgetForecastFinal: '0.00',
  budgetVariance: '0.00',
  ...over,
});
const tool = { restricted: false, open: 0, overdue: 0 };
const dashboard = (over: Record<string, number> = {}) => ({
  totals: totals(over),
  projects: [
    {
      id: 'prj_a',
      name: 'Alpha Tower',
      number: null,
      status: 'active',
      rfis: { restricted: false, open: 3, overdue: 1 },
      defects: tool,
      submittals: tool,
      claims: tool,
      variations: tool,
      incidents: tool,
      programme: tool,
      budget: {
        restricted: true,
        hasBudget: false,
        revised: '0.00',
        forecastFinal: '0.00',
        variance: '0.00',
        overBudgetCodes: 0,
      },
      attention: 1,
    },
  ],
  truncated: false,
});
const meta = {
  id: 'dsn_1',
  title: 'Monthly Report - Mar 2026',
  currentAsOf: '2026-03-31',
  program: 'Stage 1',
  createdAt: '2026-04-01T01:00:00.000Z',
  createdBy: { id: 'usr_1', name: 'Pat Manager' },
};

beforeEach(() => fake.reset());

describe('SnapshotsScreen', () => {
  it('lists title, current-as-of, created, created by and programme', async () => {
    fake.on('GET', LIST, () => ({
      data: [meta, { ...meta, id: 'dsn_2', title: 'No tag', program: null }],
    }));
    renderInProject(<SnapshotsScreen />);
    const table = await screen.findByRole('table', { name: /Dashboard snapshots/ });
    for (const h of ['Snapshot title', 'Current as of', 'Date created', 'Created by', 'Programme'])
      expect(within(table).getByText(h)).toBeTruthy();
    expect(within(table).getByRole('link', { name: 'Monthly Report - Mar 2026' })).toBeTruthy();
    expect(within(table).getAllByText('Pat Manager').length).toBe(2);
    expect(within(table).getByText('Stage 1')).toBeTruthy();
  });

  it('takes a snapshot with a title and optional programme tag', async () => {
    fake.on('GET', LIST, () => ({ data: [] }));
    fake.on('POST', LIST, () => ({ ...meta, dashboard: dashboard() }));
    renderInProject(<SnapshotsScreen />);
    expect(await screen.findByText('No snapshots yet')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Take snapshot' }));
    const save = screen.getByRole('button', { name: 'Save snapshot' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Snapshot title'), 'Board pack');
    await userEvent.type(screen.getByLabelText('Programme (optional)'), 'Stage 2');
    await userEvent.click(save);
    const sent = fake.callsTo('POST', LIST)[0]!.init.body as Record<string, unknown>;
    expect(sent.title).toBe('Board pack');
    expect(sent.program).toBe('Stage 2');
    expect(sent.currentAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('SnapshotDetailScreen', () => {
  it('reopens the dashboard as it was and compares it with today', async () => {
    fake.on('GET', ONE, () => ({ ...meta, dashboard: dashboard() }));
    fake.on('GET', PORTFOLIO, () => dashboard({ rfisOpen: 5, rfisOverdue: 0 }));
    renderInProject(<SnapshotDetailScreen snapshotId="dsn_1" />);
    expect(await screen.findByRole('heading', { name: 'Monthly Report - Mar 2026' })).toBeTruthy();
    expect(await screen.findByRole('table', { name: /Projects with open/ })).toBeTruthy();
    expect(screen.getByText('This is a saved copy')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Compare with today' }));
    const cmp = await screen.findByRole('table', { name: /compared with today/ });
    const open = within(cmp).getByText('RFIs open').closest('tr')!;
    expect(within(open).getByText('+2')).toBeTruthy();
    const overdue = within(cmp).getByText('RFIs overdue').closest('tr')!;
    expect(within(overdue).getByText('-1')).toBeTruthy();
  });
});

describe('compareTotal', () => {
  it('gives the change with a sign', () => {
    expect(compareTotal(3, 5)).toMatchObject({ change: 2, label: '+2' });
    expect(compareTotal(3, 1)).toMatchObject({ change: -2, label: '-2' });
    expect(compareTotal(3, 3)).toMatchObject({ change: 0, label: 'No change' });
  });
});
