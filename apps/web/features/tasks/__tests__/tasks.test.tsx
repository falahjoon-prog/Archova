// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MyTask } from '../data/api';
import { groupByBucket, sourceHref } from '../lib/sourceLink';

const mine = vi.fn();
vi.mock('../data/api', () => ({
  createTasksApi: () => ({ mine, create: vi.fn(), setStatus: vi.fn() }),
}));
vi.mock('@/features/projects', () => ({ useProjects: () => ({ data: { data: [] } }) }));
vi.mock('@/shared/providers/CurrentOrgProvider', () => ({
  useCurrentOrg: () => ({ orgId: 'org_1', orgSlug: 'acme', user: { id: 'usr_1', name: 'Dana' } }),
}));

const row = (over: Partial<MyTask>): MyTask => ({
  key: 'task:tsk_1',
  source: 'task',
  id: 'tsk_1',
  parentId: null,
  projectId: 'prj_1',
  projectName: 'Tower C',
  title: 'Order rebar',
  ref: 'T-1',
  dueDate: '2026-11-01',
  bucket: 'overdue',
  priority: 'medium',
  status: 'open',
  ...over,
});

describe('my tasks helpers', () => {
  it('groups rows into due buckets in display order and drops empty ones', () => {
    const groups = groupByBucket([
      row({ key: 'a', bucket: 'week' }),
      row({ key: 'b', bucket: 'overdue' }),
      row({ key: 'c', bucket: 'overdue' }),
    ]);
    expect(groups.map((g) => [g.bucket, g.rows.length])).toEqual([
      ['overdue', 2],
      ['week', 1],
    ]);
  });

  it('links meeting and incident actions to their own pages, and ad-hoc tasks to nothing', () => {
    expect(sourceHref('acme', row({}))).toBeNull();
    expect(sourceHref('acme', row({ source: 'meeting_action', parentId: 'mtg_1' }))).toContain(
      '/meetings/mtg_1',
    );
    expect(sourceHref('acme', row({ source: 'incident_action', parentId: 'inx_1' }))).toContain(
      'inx_1',
    );
  });
});

describe('MyTasksScreen', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows the day summary and each row with its source and project', async () => {
    mine.mockResolvedValue({
      data: [
        row({}),
        row({
          key: 'meeting_action:mit_1',
          source: 'meeting_action',
          id: 'mit_1',
          parentId: 'mtg_1',
          title: 'Confirm crane booking',
          ref: 'PCG 3 · 1.1',
          bucket: 'today',
          dueDate: '2026-11-07',
        }),
      ],
      digest: {
        overdue: 1,
        dueToday: 1,
        dueThisWeek: 0,
        focus: [],
        summary: '1 item is overdue, 1 item is due today.',
      },
    });
    const { MyTasksScreen } = await import('../screens/MyTasksScreen');
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MyTasksScreen />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText('1 item is overdue, 1 item is due today.')).toBeTruthy(),
    );
    expect(screen.getByRole('checkbox', { name: 'Mark done: Order rebar' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Confirm crane booking' })).toBeTruthy();
    expect(screen.getByText(/Meeting action · PCG 3 · 1.1 · Tower C/)).toBeTruthy();
    // Source rows are not completed here.
    expect(screen.queryByRole('checkbox', { name: /Confirm crane booking/ })).toBeNull();
  });

  it('says plainly when there is nothing to do', async () => {
    mine.mockResolvedValue({
      data: [],
      digest: {
        overdue: 0,
        dueToday: 0,
        dueThisWeek: 0,
        focus: [],
        summary: 'Nothing is overdue.',
      },
    });
    const { MyTasksScreen } = await import('../screens/MyTasksScreen');
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MyTasksScreen />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("You're all caught up")).toBeTruthy());
  });
});
