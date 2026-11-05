// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const perm = vi.hoisted(() => ({ level: 'admin' }));
vi.mock('@/features/projects', () => ({
  useProjectPermissions: () => ({ data: { orgRole: null, toolLevels: { workforce: perm.level } } }),
}));
vi.mock('@/features/attendance', () => ({
  useSites: () => ({ data: [{ id: 'wst_1', name: 'Main gate site', active: true }] }),
  useWorkers: () => ({ data: [{ id: 'wkr_1', fullName: 'Sam Carter', status: 'active' }] }),
}));
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { RosterScreen } = await import('../screens/RosterScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const shift = (over: Record<string, unknown> = {}) => ({
  id: 'shf_1',
  siteId: 'wst_1',
  crew: null,
  trade: 'Electrician',
  note: null,
  startsAt: '2026-11-09T21:00:00Z',
  endsAt: '2026-11-10T05:30:00Z',
  requiredHeadcount: 2,
  filled: 1,
  status: 'draft',
  publishedAt: null,
  assignments: [
    {
      id: 'sha_1',
      shiftId: 'shf_1',
      workerId: 'wkr_1',
      companyId: null,
      status: 'offered',
      notifiedAt: null,
      respondedAt: null,
    },
  ],
  ...over,
});

beforeEach(() => {
  fake.reset();
  perm.level = 'admin';
});

describe('RosterScreen', () => {
  it('lists shifts with how many are filled', async () => {
    fake.on('GET', `${P}/shifts`, () => ({ data: [shift()] }));
    renderInProject(<RosterScreen />);
    expect(await screen.findByText('1 of 2')).toBeTruthy();
    expect(screen.getByText(/Sam Carter: Offered/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
  });

  it('publishes a draft shift', async () => {
    const posts: string[] = [];
    fake.on('GET', `${P}/shifts`, () => ({ data: [shift()] }));
    fake.on('POST', `${P}/shifts/{shiftId}/publish`, () => {
      posts.push('publish');
      return shift({ status: 'published' });
    });
    renderInProject(<RosterScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(posts).toEqual(['publish']));
  });

  it('drafts a shift and refuses one that finishes before it starts', async () => {
    const posts: unknown[] = [];
    fake.on('GET', `${P}/shifts`, () => ({ data: [] }));
    fake.on('POST', `${P}/shifts`, (init: { body?: unknown }) => {
      posts.push(init.body);
      return shift();
    });
    renderInProject(<RosterScreen />);
    await screen.findByText('No shifts in this window');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Site'), 'wst_1');
    await enterText(user, screen.getByLabelText(/Trade/), 'Plumber');
    await user.clear(screen.getByLabelText(/Finish/));
    await enterText(user, screen.getByLabelText(/Finish/), '06:00');
    await user.click(screen.getByRole('button', { name: 'Draft shift' }));
    expect(await screen.findByText(/finish after it starts/)).toBeTruthy();
    expect(posts).toHaveLength(0);
    await user.clear(screen.getByLabelText(/Finish/));
    await enterText(user, screen.getByLabelText(/Finish/), '15:30');
    await user.click(screen.getByRole('button', { name: 'Draft shift' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ siteId: 'wst_1', trade: 'Plumber', requiredHeadcount: 1 });
  });

  it('gives a subcontractor the answer buttons but no manager controls', async () => {
    perm.level = 'standard';
    fake.on('GET', `${P}/shifts`, () => ({ data: [shift({ status: 'published' })] }));
    renderInProject(<RosterScreen />);
    expect(await screen.findByRole('button', { name: 'Accept for Sam Carter' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Draft shift' })).toBeNull();
  });
});
