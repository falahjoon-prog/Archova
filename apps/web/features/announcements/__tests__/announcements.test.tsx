// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSummary, relativeAge } from '../lib/time';

const api = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  markRead: vi.fn(),
  nudge: vi.fn(),
  draft: vi.fn(),
};
vi.mock('../data/api', () => ({ createAnnouncementsApi: () => api }));
vi.mock('@/features/projects', () => ({
  useProjectMembers: () => ({
    data: {
      data: [
        {
          userId: 'usr_a',
          name: 'Ana Steel',
          email: 'a@x.au',
          companyId: 'cmp_1',
          status: 'active',
        },
        {
          userId: 'usr_b',
          name: 'Bo Tiler',
          email: 'b@x.au',
          companyId: 'cmp_2',
          status: 'active',
        },
      ],
    },
  }),
  useCompanies: () => ({
    data: {
      data: [
        { id: 'cmp_1', name: 'Steelco' },
        { id: 'cmp_2', name: 'Tileco' },
      ],
    },
  }),
  useProjectPermissions: () => ({ data: { orgRole: 'owner', toolLevels: {} } }),
}));
vi.mock('@/shared/providers/CurrentOrgProvider', () => ({
  useCurrentOrg: () => ({ orgId: 'org_1', orgSlug: 'harbour' }),
}));

import { AnnouncementDialog } from '../components/AnnouncementDialog';
import { AnnouncementsCard } from '../components/AnnouncementsCard';
import { ComposeDialog } from '../components/ComposeDialog';

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );

afterEach(() => Object.values(api).forEach((f) => f.mockReset()));

const summary = {
  id: 'ann_1',
  projectId: 'prj_1',
  title: 'Pour moved',
  preview: 'The pour is now Monday.',
  priority: 'important',
  audienceKind: 'all',
  createdById: 'usr_pm',
  createdByName: 'Pat Manager',
  createdAt: '2026-11-07T01:00:00Z',
  readByHours: 24,
  isMine: false,
  unread: true,
  readAt: null,
  receipts: null,
};

describe('time helpers', () => {
  it('reads like a person would say it', () => {
    const now = new Date('2026-11-07T12:00:00Z');
    expect(relativeAge('2026-11-07T11:50:00Z', 'Australia/Melbourne', now)).toBe('10 minutes ago');
    expect(relativeAge('2026-11-06T11:00:00Z', 'Australia/Melbourne', now)).toBe('Yesterday');
    expect(readSummary({ recipientCount: 5, readCount: 3 })).toBe('3 of 5 have read it');
    expect(readSummary({ recipientCount: 1, readCount: 0 })).toBe('0 of 1 has read it');
  });
});

describe('AnnouncementsCard', () => {
  it('shows what was sent to you, with the unread count and an important flag', async () => {
    api.list.mockResolvedValue({ data: [summary], nextCursor: null, unreadCount: 1 });
    wrap(<AnnouncementsCard projectId="prj_1" timeZone="Australia/Melbourne" />);
    expect(await screen.findByText('Pour moved')).toBeTruthy();
    expect(screen.getByText('Important')).toBeTruthy();
    expect(screen.getByLabelText('1 unread')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Open announcement: Pour moved \(unread\)/ }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See all announcements' })).toBeTruthy();
  });
});

describe('AnnouncementDialog', () => {
  const detail = {
    ...summary,
    unread: false,
    isMine: true,
    receipts: { recipientCount: 2, readCount: 0 },
    body: 'The pour is now Monday.',
    audience: { kind: 'all', companyIds: [], userIds: [] },
    dueAt: '2026-11-08T01:00:00Z',
    recipients: [
      { userId: 'usr_a', name: 'Ana Steel', isKey: true, readAt: null, nudgedAt: null },
      { userId: 'usr_b', name: 'Bo Tiler', isKey: false, readAt: null, nudgedAt: null },
    ],
    flags: [
      {
        userId: 'usr_a',
        name: 'Ana Steel',
        isKey: true,
        hoursOverdue: 6,
        nudgedAt: null,
        canNudge: true,
      },
    ],
  };

  it('lists Nova’s flags but sends nothing until the sender confirms', async () => {
    api.get.mockResolvedValue(detail);
    api.nudge.mockResolvedValue({ nudged: 1, skipped: 0 });
    wrap(
      <AnnouncementDialog
        projectId="prj_1"
        timeZone="Australia/Melbourne"
        announcementId="ann_1"
        onClose={() => undefined}
      />,
    );
    expect(await screen.findByText('0 of 2 have read it')).toBeTruthy();
    expect(screen.getByText(/6 hours overdue · key person/)).toBeTruthy();
    expect(api.nudge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send reminder to 1' }));
    await waitFor(() => expect(api.nudge).toHaveBeenCalledWith('prj_1', 'ann_1', ['usr_a']));
    expect(await screen.findByText('Reminder sent to 1 person.')).toBeTruthy();
  });

  it('marks an unread announcement read when it is opened', async () => {
    api.get.mockResolvedValue({
      ...summary,
      unread: true,
      isMine: false,
      receipts: null,
      body: 'Hi',
      audience: { kind: 'all', companyIds: [], userIds: [] },
      dueAt: null,
      recipients: null,
      flags: [],
    });
    api.markRead.mockResolvedValue({});
    wrap(
      <AnnouncementDialog
        projectId="prj_1"
        timeZone="Australia/Melbourne"
        announcementId="ann_1"
        onClose={() => undefined}
      />,
    );
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith('prj_1', 'ann_1'));
    expect(screen.queryByRole('region', { name: 'Read receipts' })).toBeNull();
  });
});

describe('ComposeDialog', () => {
  it('lets Nova fill the draft from notes, then posts what the person edited', async () => {
    api.draft.mockResolvedValue({
      runId: 'air_1',
      title: 'Pour moved to Monday',
      body: 'The pour is now Monday.',
      priority: 'normal',
      notes: ['Removed 1 sentence with a date, day or number your notes don’t mention.'],
    });
    api.create.mockResolvedValue({ id: 'ann_9' });
    const onPosted = vi.fn();
    wrap(<ComposeDialog projectId="prj_1" open onClose={() => undefined} onPosted={onPosted} />);
    fireEvent.change(screen.getByLabelText(/What changed/), {
      target: { value: 'Pour is Monday' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Draft with Nova' }));
    expect(await screen.findByText(/Removed 1 sentence/)).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Pour moved to Monday');
    // Nothing is posted by drafting.
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Pour moved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post announcement' }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0]![1]).toMatchObject({
      title: 'Pour moved',
      audience: { kind: 'all' },
      priority: 'normal',
      readByHours: null,
    });
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith('ann_9'));
  });

  it('needs somebody to send it to when not sending to everyone', () => {
    wrap(
      <ComposeDialog projectId="prj_1" open onClose={() => undefined} onPosted={() => undefined} />,
    );
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Hi' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'There' } });
    fireEvent.click(screen.getByLabelText(/Everyone on the project/));
    expect(screen.getByText('Choose at least one company or person.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Post announcement' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText('Steelco'));
    expect(
      (screen.getByRole('button', { name: 'Post announcement' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
