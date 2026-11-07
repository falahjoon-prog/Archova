// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialsOf, relativeAge } from '../lib/time';

const list = vi.fn();
vi.mock('../data/api', () => ({
  createConversationsApi: () => ({ list, get: vi.fn(), create: vi.fn(), post: vi.fn() }),
}));
vi.mock('@/features/assistant', () => ({ usePublishAssistantScope: () => undefined }));
vi.mock('@/shared/providers/CurrentProjectProvider', () => ({
  useCurrentProject: () => ({ projectId: 'prj_1', timezone: 'Australia/Melbourne' }),
}));
vi.mock('@/shared/providers/CurrentOrgProvider', () => ({
  useCurrentOrg: () => ({ orgId: 'org_1', orgSlug: 'harbour' }),
}));

import { ApiError } from '@archova/api-client';
import { ConversationsCard } from '../components/ConversationsCard';

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );

afterEach(() => list.mockReset());

describe('relativeAge', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  it('reads like a person would say it', () => {
    expect(relativeAge('2026-11-06T11:59:40Z', 'Australia/Melbourne', now)).toBe('Just now');
    expect(relativeAge('2026-11-06T11:50:00Z', 'Australia/Melbourne', now)).toBe('10 minutes ago');
    expect(relativeAge('2026-11-06T11:00:00Z', 'Australia/Melbourne', now)).toBe('1 hour ago');
    expect(relativeAge('2026-11-05T11:00:00Z', 'Australia/Melbourne', now)).toBe('Yesterday');
    expect(relativeAge('2026-11-02T11:00:00Z', 'Australia/Melbourne', now)).toBe('4 days ago');
  });
  it('makes initials', () => {
    expect(initialsOf('Mike Hawkins')).toBe('MH');
    expect(initialsOf('priya')).toBe('P');
    expect(initialsOf('  ')).toBe('?');
  });
});

describe('ConversationsCard', () => {
  it('shows the latest conversations with who said what', async () => {
    list.mockResolvedValue({
      nextCursor: null,
      data: [
        {
          id: 'cnv_1',
          projectId: 'prj_1',
          subject: 'Pour programme',
          messageCount: 3,
          createdById: 'usr_1',
          createdByName: 'Mike Hawkins',
          lastMessageAt: new Date().toISOString(),
          lastMessage: {
            id: 'cnm_1',
            authorId: 'usr_1',
            authorName: 'Mike Hawkins',
            body: 'The concrete sub is not available this weekend.',
            createdAt: new Date().toISOString(),
          },
        },
      ],
    });
    wrap(<ConversationsCard projectId="prj_1" timeZone="Australia/Melbourne" />);
    expect(await screen.findByText('The concrete sub is not available this weekend.')).toBeTruthy();
    expect(screen.getByText('Pour programme')).toBeTruthy();
    expect(screen.getByText('MH')).toBeTruthy();
    expect(screen.getByRole('button', { name: /New conversation/ })).toBeTruthy();
  });

  it('invites the first conversation when there are none', async () => {
    list.mockResolvedValue({ data: [], nextCursor: null });
    wrap(<ConversationsCard projectId="prj_1" timeZone="Australia/Melbourne" />);
    expect(await screen.findByText(/No conversations yet/)).toBeTruthy();
  });

  it('renders nothing for an outside user the API refuses', async () => {
    list.mockRejectedValue(new ApiError(403, null));
    const { container } = wrap(
      <ConversationsCard projectId="prj_1" timeZone="Australia/Melbourne" />,
    );
    await waitFor(() => expect(list).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('.conversations')).toBeNull());
  });
});

describe('ConversationsScreen', () => {
  it('lists every conversation and offers more when there is another page', async () => {
    const { ConversationsScreen } = await import('../screens/ConversationsScreen');
    const row = (n: number) => ({
      id: `cnv_${n}`,
      projectId: 'prj_1',
      subject: `Subject ${n}`,
      messageCount: 2,
      createdById: 'usr_1',
      createdByName: 'Mike Hawkins',
      lastMessageAt: new Date().toISOString(),
      lastMessage: {
        id: `cnm_${n}`,
        authorId: 'usr_1',
        authorName: 'Mike Hawkins',
        body: `Body ${n}`,
        createdAt: new Date().toISOString(),
      },
    });
    list.mockResolvedValueOnce({ data: [row(1), row(2)], nextCursor: 'next' });
    wrap(<ConversationsScreen />);
    expect(await screen.findByText('Subject 1')).toBeTruthy();
    expect(screen.getByText('Subject 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
  });
});
