// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
vi.mock('next/navigation', async () => (await import('@/test/render')).navigationMock);

const upload = vi.hoisted(() => vi.fn(async () => ({ id: 'fil_00000000000000000000000009' })));
vi.mock('@/shared/lib/uploads', () => ({
  uploadFile: upload,
  fileDownloadUrl: vi.fn(async () => 'https://files.test/snap.png'),
}));

const { CoordinationScreen } = await import('../screens/CoordinationScreen');
const { CreateIssueDialog } = await import('../components/CreateIssueDialog');
const { render } = await import('@testing-library/react');

const L = '/v1/orgs/{orgId}/projects/{projectId}/coordination-issues';
const issue = (n: number, over = {}) => ({
  id: `cis_0000000000000000000000000${n}`,
  projectId: 'prj_test',
  number: n,
  title: `Issue ${n}`,
  description: '',
  status: 'open',
  priority: 'medium',
  assigneeId: null,
  dueDate: null,
  modelId: null,
  elementGuids: [],
  location: '',
  rfiId: null,
  pin: null,
  sheetId: null,
  snapshotFileId: null,
  resolvedAt: null,
  commentCount: 0,
  version: 1,
  createdAt: '2026-11-05T00:00:00Z',
  updatedAt: '2026-11-05T00:00:00Z',
  ...over,
});

const list = [
  issue(1, { status: 'open', priority: 'critical' }),
  issue(2, { status: 'resolved', priority: 'low' }),
  issue(3, { status: 'open', priority: 'low', title: 'Sprinkler head clash' }),
];

beforeEach(() => {
  fake.reset();
  upload.mockClear();
  nav.search = '';
  fake.on('GET', '/v1/orgs/{orgId}/projects/{projectId}/bim-models', () => ({ data: [] }));
  fake.on('GET', L, () => ({ data: list }));
});

describe('the register', () => {
  it('shows the dashboard above the table', async () => {
    renderInProject(<CoordinationScreen />);
    await screen.findByRole('table', { name: 'Coordination issues' });
    expect(screen.getByText('Overview')).toBeTruthy();
    expect(screen.getByText('Progress')).toBeTruthy();
    expect(screen.getByText('Ball in court', { selector: 'h2, h3, [class*=title]' })).toBeTruthy();
    expect(screen.getByText(/33%/)).toBeTruthy();
  });

  it('filters by status and by search text', async () => {
    nav.search = 'status=open&q=sprinkler';
    renderInProject(<CoordinationScreen />);
    const table = await screen.findByRole('table', { name: 'Coordination issues' });
    expect(within(table).getByText('Sprinkler head clash')).toBeTruthy();
    expect(within(table).queryByText('Issue 1')).toBeNull();
    expect(within(table).queryByText('Issue 2')).toBeNull();
  });

  it('groups rows under a heading with a count, in status order', async () => {
    nav.search = 'group=status';
    renderInProject(<CoordinationScreen />);
    const table = await screen.findByRole('table', { name: 'Coordination issues' });
    const headings = [...table.querySelectorAll('tr.ac-table__group th')].map((h) => h.textContent);
    expect(headings).toEqual(['Open · 2', 'Resolved · 1']);
  });
});

describe('the detail page', () => {
  it('shows the drawing the issue was raised on, with its snapshot and a link to the sheet', async () => {
    nav.search = 'issue=cis_00000000000000000000000001';
    const pinned = issue(1, {
      pin: { drawingRevisionId: 'drv_00000000000000000000000001', x: 0.25, y: 0.75 },
      sheetId: 'dsh_00000000000000000000000001',
      snapshotFileId: 'fil_00000000000000000000000002',
    });
    fake.on('GET', `${L}/{issueId}`, () => ({ issue: pinned, comments: [] }));
    renderInProject(<CoordinationScreen />);
    const link = await screen.findByRole('link', { name: 'Open on the drawing' });
    expect(link.getAttribute('href')).toContain(
      '/drawings/dsh_00000000000000000000000001?rev=drv_00000000000000000000000001',
    );
    expect(screen.getByText('Pinned 25% across, 75% down.')).toBeTruthy();
    expect((await screen.findByAltText(/Snapshot of the drawing/)).getAttribute('src')).toBe(
      'https://files.test/snap.png',
    );
  });

  it('says so when the issue was not raised from a drawing', async () => {
    nav.search = 'issue=cis_00000000000000000000000001';
    fake.on('GET', `${L}/{issueId}`, () => ({ issue: issue(1), comments: [] }));
    renderInProject(<CoordinationScreen />);
    expect(await screen.findByText('Not raised from a drawing.')).toBeTruthy();
  });
});

describe('raising an issue from a point on a drawing', () => {
  it('stores the snapshot first, then sends the pin with its file', async () => {
    const post = vi.fn(() => ({ issue: issue(4), comments: [] }));
    fake.on('POST', L, post);
    const pin = { drawingRevisionId: 'drv_00000000000000000000000001', x: 0.4, y: 0.6 };
    const user = userEvent.setup();
    const created = vi.fn();
    // jsdom has no object URLs.
    URL.createObjectURL = vi.fn(() => 'blob:snap');
    URL.revokeObjectURL = vi.fn();
    renderInProject(
      <CreateIssueDialog
        open
        onClose={() => {}}
        onCreated={created}
        pin={pin}
        pinLabel="A-101 Level 3"
        snapshot={new Blob(['x'], { type: 'image/png' })}
      />,
    );
    expect(screen.getByText(/Pinned on A-101 Level 3 at 40% across, 60% down/)).toBeTruthy();
    expect(screen.queryByLabelText('Model')).toBeNull();
    await user.type(screen.getByLabelText('Title'), 'Beam hits duct');
    await user.type(screen.getByLabelText('Location'), 'Grid C4');
    await user.click(screen.getByRole('button', { name: 'Raise issue' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(upload).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        module: 'bim',
        file: expect.objectContaining({ type: 'image/png' }),
      }),
    );
    const body = (post.mock.calls[0] as unknown as [{ body: Record<string, unknown> }])[0].body;
    expect(body).toMatchObject({
      title: 'Beam hits duct',
      location: 'Grid C4',
      pin,
      snapshotFileId: 'fil_00000000000000000000000009',
    });
    expect(body).not.toHaveProperty('snapshot');
    await waitFor(() => expect(created).toHaveBeenCalled());
  });
});
void render;
