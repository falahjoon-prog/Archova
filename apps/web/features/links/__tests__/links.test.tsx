// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@archova/api-client';
import { humanStatus, itemHref } from '../lib/labels';

const list = vi.fn();
const remove = vi.fn();
vi.mock('../data/api', () => ({
  createLinksApi: () => ({ list, remove, candidates: vi.fn(), create: vi.fn() }),
}));
vi.mock('@/shared/providers/CurrentProjectProvider', () => ({
  useCurrentProject: () => ({ projectId: 'prj_1', timezone: 'Australia/Brisbane' }),
}));
vi.mock('@/shared/providers/CurrentOrgProvider', () => ({
  useCurrentOrg: () => ({ orgId: 'org_1', orgSlug: 'harbour' }),
}));

import { RelatedItemsPanel } from '../components/RelatedItemsPanel';

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );

const row = (over: object = {}) => ({
  linkId: 'rli_1',
  side: 'from',
  reason: 'caused_by',
  note: null,
  origin: 'user',
  createdById: 'usr_1',
  createdByName: 'Pat',
  createdAt: '2026-11-07T00:00:00Z',
  item: { type: 'rfi', id: 'rfi_9', ref: 'RFI-009', title: 'Slab edge detail', status: 'open' },
  ...over,
});

afterEach(() => {
  list.mockReset();
  remove.mockReset();
});

describe('labels', () => {
  it('says statuses in plain words and points each type at its page', () => {
    expect(humanStatus('in_review')).toBe('In review');
    expect(itemHref('harbour', 'prj_1', { type: 'rfi', id: 'rfi_9' })).toBe(
      '/harbour/projects/prj_1/rfis/rfi_9',
    );
  });
});

describe('RelatedItemsPanel', () => {
  it('lists linked items with the reason in this record’s voice, and counts hidden ones', async () => {
    list.mockResolvedValue({
      data: [
        row(),
        row({
          linkId: 'rli_2',
          side: 'to',
          item: {
            type: 'defect',
            id: 'dfx_1',
            ref: 'DEF-004',
            title: 'Chipped tile',
            status: 'ready_for_review',
          },
        }),
      ],
      hidden: 2,
    });
    wrap(<RelatedItemsPanel type="submittal" id="sbm_1" />);
    expect(await screen.findByText('Caused by · RFI')).toBeTruthy();
    // Seen from the other end, the same reason reads the other way round.
    expect(screen.getByText('Led to · Defect')).toBeTruthy();
    expect(screen.getByText('Ready for review')).toBeTruthy();
    expect(screen.getByText(/2 more linked items are not shown/)).toBeTruthy();
    expect(list).toHaveBeenCalledWith('prj_1', 'submittal', 'sbm_1');
  });

  it('invites the first link when there are none', async () => {
    list.mockResolvedValue({ data: [], hidden: 0 });
    wrap(<RelatedItemsPanel type="rfi" id="rfi_1" />);
    expect(await screen.findByText(/Nothing linked yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Link item/ })).toBeTruthy();
  });

  it('removes a link', async () => {
    list.mockResolvedValue({ data: [row()], hidden: 0 });
    remove.mockResolvedValue(undefined);
    wrap(<RelatedItemsPanel type="submittal" id="sbm_1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Remove link to RFI-009/ }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('prj_1', 'rli_1'));
  });

  it('shows nothing to someone who may not read related items', async () => {
    list.mockRejectedValue(new ApiError(403, null));
    const { container } = wrap(<RelatedItemsPanel type="rfi" id="rfi_1" />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('section')).toBeNull());
  });
});
