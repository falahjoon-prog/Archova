// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';

import { fakeProblem } from '@/test/fake-api';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { LateSubmissionsScreen, describeChange } = await import('../screens/LateSubmissionsScreen');

const P = '/v1/orgs/{orgId}/projects/{projectId}/late-submissions';
const item = (over = {}) => ({
  id: 'lsb_00000000000000000000000001',
  projectId: 'prj_test',
  module: 'diary',
  command: 'createEntry',
  entityId: 'e1',
  baseVersion: null,
  submittedBy: 'usr_00000000000000000000000001',
  clientAt: '2026-11-04T01:00:00Z',
  receivedAt: '2026-11-04T02:00:00Z',
  status: 'pending',
  ...over,
});

beforeEach(() => {
  fake.reset();
  nav.search = '';
  fake.on('GET', P, () => ({ items: [item()], pendingCount: 1 }));
});

describe('LateSubmissionsScreen', () => {
  it('describes a change in words', () => {
    expect(describeChange('diary', 'createEntry')).toBe('Diary: create entry');
  });

  it('lists waiting changes and accepts one', async () => {
    const user = userEvent.setup();
    fake.on('POST', `${P}/{lateSubmissionId}/accept`, () => item({ status: 'accepted' }));
    renderInProject(<LateSubmissionsScreen />);
    const table = await screen.findByRole('table', { name: 'Late submissions' });
    expect(within(table).getByText('Diary: create entry')).toBeTruthy();
    expect(screen.getByText(/1 change waiting/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Accept Diary: create entry' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/{lateSubmissionId}/accept`)).toHaveLength(1),
    );
  });

  it('shows why an accept was refused and leaves the change waiting', async () => {
    const user = userEvent.setup();
    fake.on('POST', `${P}/{lateSubmissionId}/accept`, () => fakeProblem(409, 'version_conflict'));
    renderInProject(<LateSubmissionsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Accept Diary: create entry' }));
    expect(await screen.findByText('This change could not be accepted')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject Diary: create entry' })).toBeTruthy();
  });

  it('rejects with a note', async () => {
    const user = userEvent.setup();
    fake.on('POST', `${P}/{lateSubmissionId}/reject`, () => item({ status: 'rejected' }));
    renderInProject(<LateSubmissionsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Reject Diary: create entry' }));
    await enterText(user, screen.getByLabelText('Note (optional)'), 'Left the project');
    await user.click(screen.getByRole('button', { name: 'Reject change' }));
    await waitFor(() =>
      expect(fake.callsTo('POST', `${P}/{lateSubmissionId}/reject`)).toHaveLength(1),
    );
    expect(fake.callsTo('POST', `${P}/{lateSubmissionId}/reject`)[0]!.init.body).toEqual({
      note: 'Left the project',
    });
  });
});
