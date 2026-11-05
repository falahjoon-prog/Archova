// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const { CoordinationScreen } = await import('../screens/CoordinationScreen');
const { nextStatuses, parseGuids } = await import('../lib/issues');

const L = '/v1/orgs/{orgId}/projects/{projectId}/coordination-issues';
const issue = (over = {}) => ({
  id: 'cis_00000000000000000000000001',
  projectId: 'prj_test',
  number: 1,
  title: 'Duct clashes with beam B12',
  description: 'Ducting runs through the beam.',
  status: 'open',
  priority: 'high',
  assigneeId: null,
  dueDate: null,
  modelId: null,
  elementGuids: ['3cUkl32yn9qRSPvBJVyWYp'],
  location: 'Level 2, grid C4',
  rfiId: null,
  resolvedAt: null,
  commentCount: 0,
  version: 1,
  createdAt: '2026-11-05T00:00:00Z',
  updatedAt: '2026-11-05T00:00:00Z',
  ...over,
});

beforeEach(() => {
  fake.reset();
  nav.search = '';
  fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/bim-models', () => ({ data: [] }));
  fake.on('GET', L, () => ({ data: [issue()] }));
  fake.on('GET', `${L}/{issueId}`, () => ({ issue: issue(), comments: [] }));
});

describe('coordination lifecycle helpers', () => {
  it('offers only the moves the server allows', () => {
    expect(nextStatuses('closed')).toEqual(['open']);
    expect(nextStatuses('resolved')).not.toContain('in_progress');
  });
  it('reads pasted element ids', () => {
    expect(parseGuids('abc, def\nghi  jkl;')).toEqual(['abc', 'def', 'ghi', 'jkl']);
  });
});

describe('CoordinationScreen', () => {
  it('lists the issues with their status', async () => {
    renderInProject(<CoordinationScreen />);
    const table = await screen.findByRole('table', { name: 'Coordination issues' });
    expect(within(table).getByText('CI-001')).toBeTruthy();
    expect(within(table).getByText('Duct clashes with beam B12')).toBeTruthy();
    expect(within(table).getByText('Open')).toBeTruthy();
  });

  it('moves an issue along with the version it read', async () => {
    nav.search = 'issue=cis_00000000000000000000000001';
    const patch = vi.fn(() => ({
      issue: issue({ status: 'in_progress', version: 2 }),
      comments: [],
    }));
    fake.on('PATCH', `${L}/{issueId}`, patch);
    renderInProject(<CoordinationScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Mark in progress' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
  });

  it('raises an issue', async () => {
    const post = vi.fn(() => ({ issue: issue({ number: 2, title: 'New clash' }), comments: [] }));
    fake.on('POST', L, post);
    renderInProject(<CoordinationScreen />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Raise an issue' }));
    await user.type(screen.getByLabelText('Title'), 'New clash');
    await user.click(screen.getByRole('button', { name: 'Raise issue' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
  });
});
