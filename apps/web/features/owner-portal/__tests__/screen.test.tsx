// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', async () => {
  const { createQueries } = await import('@archova/query');
  return { ...fake.module, queries: createQueries(fake.module.api as never) };
});
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { OwnerPortalScreen, parseDollars } = await import('../screens/OwnerPortalScreen');

const B = '/v1/orgs/{orgId}/projects/{projectId}/owner-portal';
const PERMS = '/v1/orgs/{orgId}/projects/{projectId}/permissions';
const perms = (over = {}) => ({
  orgRole: null,
  isExternal: true,
  projectId: 'prj_test',
  companyId: 'cmp_client',
  isProjectMember: true,
  toolLevels: { owner_portal: 'read' },
  granular: ['ownerportal.approvals.decide'],
  denied: [],
  companyScopedTools: [],
  ...over,
});
const update = (over = {}) => ({
  id: 'opu_00000000000000000000000001',
  projectId: 'prj_test',
  title: 'October progress',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  summary: 'Slab poured on level 2.',
  percentComplete: 35,
  milestones: [{ name: 'Level 2 slab', date: '2026-10-20', status: 'done' }],
  status: 'published',
  publishedAt: '2026-11-01T01:00:00Z',
  version: 2,
  createdAt: '2026-10-31T01:00:00Z',
  updatedAt: '2026-11-01T01:00:00Z',
  ...over,
});
const approval = (over = {}) => ({
  id: 'oap_00000000000000000000000001',
  projectId: 'prj_test',
  number: 1,
  title: 'Lobby stone upgrade',
  description: '',
  amountCents: 4_500_000,
  dueDate: null,
  status: 'requested',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  version: 1,
  createdAt: '2026-11-01T01:00:00Z',
  ...over,
});

beforeEach(() => {
  fake.reset();
  nav.search = '';
  fake.on('GET', PERMS, () => perms());
  fake.on('GET', `${B}/progress-updates`, () => ({ data: [update()] }));
  fake.on('GET', `${B}/approvals`, () => ({ data: [approval()] }));
  fake.on('GET', `${B}/capital-plan`, () => ({
    items: [
      {
        id: 'oci_1',
        projectId: 'prj_test',
        fiscalYear: 2027,
        category: 'Construction',
        description: '',
        budgetCents: 100_000_000,
        forecastCents: 105_000_000,
        spentCents: 0,
        version: 1,
      },
    ],
    totals: [
      { fiscalYear: 2027, budgetCents: 100_000_000, forecastCents: 105_000_000, spentCents: 0 },
      { fiscalYear: null, budgetCents: 100_000_000, forecastCents: 105_000_000, spentCents: 0 },
    ],
  }));
});

describe('parseDollars', () => {
  it('reads dollars to cents and rejects junk', () => {
    expect(parseDollars('$4,500.50')).toBe(450050);
    expect(parseDollars('')).toBeNull();
    expect(parseDollars('abc')).toBeNull();
    expect(parseDollars('-5')).toBeNull();
  });
});

describe('OwnerPortalScreen', () => {
  it('shows the client a published update with no builder actions', async () => {
    renderInProject(<OwnerPortalScreen />);
    expect(await screen.findByText('October progress')).toBeTruthy();
    expect(screen.getByText('35% complete')).toBeTruthy();
    const milestones = screen.getByRole('table', { name: 'Milestones for October progress' });
    expect(within(milestones).getByText('Level 2 slab')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New progress update' })).toBeNull();
  });

  it('lets the builder save a draft update', async () => {
    const user = userEvent.setup();
    fake.on('GET', PERMS, () =>
      perms({ toolLevels: { owner_portal: 'standard' }, granular: [], isExternal: false }),
    );
    fake.on('POST', `${B}/progress-updates`, () => update({ status: 'draft', publishedAt: null }));
    renderInProject(<OwnerPortalScreen />);
    await user.click(await screen.findByRole('button', { name: 'New progress update' }));
    const dialog = await screen.findByRole('dialog');
    await enterText(user, within(dialog).getByLabelText('Title'), 'November progress');
    await enterText(user, within(dialog).getByLabelText('Period start'), '2026-11-01');
    await enterText(user, within(dialog).getByLabelText('Period end'), '2026-11-30');
    await enterText(user, within(dialog).getByLabelText('Percent complete'), '50');
    await user.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fake.callsTo('POST', `${B}/progress-updates`)).toHaveLength(1));
    expect(fake.callsTo('POST', `${B}/progress-updates`)[0]!.init.body).toMatchObject({
      title: 'November progress',
      periodStart: '2026-11-01',
      percentComplete: 50,
    });
  });

  it('lets the client approve a request', async () => {
    const user = userEvent.setup();
    nav.search = 'tab=approvals';
    fake.on('POST', `${B}/approvals/{approvalId}/decision`, () => approval({ status: 'approved' }));
    renderInProject(<OwnerPortalScreen />);
    await user.click(await screen.findByRole('button', { name: 'Decide Lobby stone upgrade' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/final/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${B}/approvals/{approvalId}/decision`)).toHaveLength(1),
    );
    expect(fake.callsTo('POST', `${B}/approvals/{approvalId}/decision`)[0]!.init.body).toEqual({
      decision: 'approved',
    });
  });

  it('shows the capital plan with its totals', async () => {
    nav.search = 'tab=capital';
    renderInProject(<OwnerPortalScreen />);
    const table = await screen.findByRole('table', { name: 'Capital plan' });
    expect(within(table).getByText('Construction')).toBeTruthy();
    const totals = screen.getByRole('table', { name: 'Capital plan totals' });
    expect(within(totals).getByText('All years')).toBeTruthy();
    expect(within(table).getAllByText('$1,000,000.00').length).toBeGreaterThan(0);
  });
});
