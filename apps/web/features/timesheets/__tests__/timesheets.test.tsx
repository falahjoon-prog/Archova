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
  useWorkers: () => ({ data: [{ id: 'wkr_abcdef', fullName: 'Dana Formworker' }] }),
}));
vi.mock('@/features/budget', () => ({ useCostCodes: () => ({ data: [] }) }));
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { TimesheetsScreen } = await import('../screens/TimesheetsScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}';
const sheet = (over: Record<string, unknown> = {}) => ({
  id: 'tsh_1',
  workerId: 'wkr_abcdef',
  companyId: null,
  date: '2026-11-04',
  status: 'draft',
  submittedAt: null,
  approvedAt: null,
  rejectionReason: null,
  paidMinutes: 450,
  paidHours: '7.50',
  lines: [
    {
      id: 'tsl_1',
      minutes: 480,
      breakMinutes: 30,
      costCodeId: null,
      source: 'attendance',
      adjustedReason: null,
    },
  ],
  ...over,
});

beforeEach(() => {
  fake.reset();
  perm.level = 'admin';
});

describe('TimesheetsScreen', () => {
  it('lists timesheets with paid hours', async () => {
    fake.on('GET', `${P}/timesheets`, () => ({ data: [sheet()] }));
    renderInProject(<TimesheetsScreen />);
    expect(await screen.findByText('7.50')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('Dana Formworker')).toBeTruthy();
  });

  it('requires a reason before changing hours', async () => {
    const patches: unknown[] = [];
    fake.on('GET', `${P}/timesheets`, () => ({ data: [sheet()] }));
    fake.on('PATCH', `${P}/timesheets/{timesheetId}/lines/{lineId}`, (init: { body?: unknown }) => {
      patches.push(init.body);
      return sheet();
    });
    renderInProject(<TimesheetsScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Open/ }));
    await user.selectOptions(screen.getByLabelText('Change'), 'tsl_1');
    await enterText(user, screen.getByLabelText(/Break minutes/), '45');
    await user.click(screen.getByRole('button', { name: 'Save change' }));
    expect(await screen.findByText(/reason for the change/)).toBeTruthy();
    expect(patches).toHaveLength(0);
    await enterText(user, screen.getByLabelText(/Reason/), 'Longer lunch');
    await user.click(screen.getByRole('button', { name: 'Save change' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({ breakMinutes: 45, reason: 'Longer lunch' });
  });

  it('lets a supervisor approve a submitted sheet and locks the lines', async () => {
    const posts: string[] = [];
    fake.on('GET', `${P}/timesheets`, () => ({ data: [sheet({ status: 'submitted' })] }));
    fake.on('POST', `${P}/timesheets/{timesheetId}/approve`, () => {
      posts.push('approve');
      return sheet({ status: 'approved' });
    });
    renderInProject(<TimesheetsScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Approve/ }));
    await waitFor(() => expect(posts).toEqual(['approve']));
    await user.click(screen.getByRole('button', { name: /^Open/ }));
    expect(screen.queryByRole('button', { name: 'Add hours' })).toBeNull();
  });

  it('gives a crew no approve or export controls', async () => {
    perm.level = 'standard';
    fake.on('GET', `${P}/timesheets`, () => ({ data: [sheet({ status: 'submitted' })] }));
    renderInProject(<TimesheetsScreen />);
    expect(await screen.findByText('7.50')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Export approved/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Build from sign-ins' })).toBeTruthy();
  });
});
