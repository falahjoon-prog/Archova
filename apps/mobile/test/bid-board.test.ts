import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@archova/api-client';
import { mobileRoutes } from '@archova/routes';
import {
  boardSubtitle,
  companyNames,
  dueLine,
  getBidBoard,
  listBidderLists,
  listSubtitle,
  lowestText,
  responseText,
} from '../features/bid-board';

vi.mock('../features/bid-board/screens/BidBoardScreen', () => ({}));

const tally = (o: Partial<Record<string, number>> = {}) => ({
  invited: 0,
  viewed: 0,
  declined: 0,
  intendsToQuote: 0,
  submitted: 0,
  awaiting: 0,
  ...o,
});

describe('bid board text', () => {
  it('words the invitee answers', () => {
    expect(responseText(tally({ submitted: 2, declined: 1, invited: 1, awaiting: 1 }))).toBe(
      '2 quoted, 1 declined, 1 awaiting',
    );
    expect(responseText(tally())).toBe('No invitees');
  });

  it('says when a package is due and flags the urgent ones', () => {
    expect(dueLine(null, null)).toBe('No due date');
    expect(dueLine('2026-11-07T05:00:00Z', 'overdue')).toMatch(/^Due 7 Nov.*, overdue$/);
    expect(dueLine('2026-11-07T05:00:00Z', 'closing_soon')).toMatch(/, closing soon$/);
    expect(dueLine('2026-11-07T05:00:00Z', 'open')).toMatch(/^Due 7 Nov/);
    expect(dueLine('2026-11-07T05:00:00Z', 'open')).not.toMatch(/overdue|closing/);
  });

  it('formats the lowest price without float maths', () => {
    expect(lowestText('11000.00')).toBe('$11,000.00 lowest ex GST');
    expect(lowestText('48250.5')).toBe('$48,250.50 lowest ex GST');
    expect(lowestText(null)).toBeNull();
  });

  it('summarises a board row, leaving out what is empty', () => {
    const row = boardSubtitle({
      projectName: 'Harbour St Tower',
      status: 'out_to_tender',
      dueAt: null,
      dueState: null,
      invites: tally({ submitted: 1 }),
      quotesToReview: 0,
      lowestExGst: null,
    });
    expect(row).toBe('Harbour St Tower. Out to tender. No due date. 1 quoted');
  });

  it('lists who is on a bidder list, or just the count without names', () => {
    const l = { trade: 'Tiling', companyIds: ['a', 'b'] };
    expect(listSubtitle(l, new Map([['a', 'Tiles A']]))).toBe('Tiling, 2 companies: Tiles A');
    expect(listSubtitle(l, new Map())).toBe('Tiling, 2 companies');
    expect(listSubtitle({ trade: '', companyIds: ['a'] }, new Map())).toBe('1 company');
  });

  it('has a route for the board', () => {
    expect(mobileRoutes.bidBoard()).toBe('/bid-board');
  });
});

describe('bid board calls', () => {
  const ok = (data: unknown) => ({ data, response: { ok: true } });

  it('reads the board and the lists for the org', async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [{ id: 't' }], asOf: 'x', truncated: false }))
      .mockResolvedValueOnce(ok({ data: [{ id: 'l' }] }));
    const api = { GET } as unknown as ApiClient;
    expect((await getBidBoard(api, 'org_1')).data).toEqual([{ id: 't' }]);
    expect(await listBidderLists(api, 'org_1')).toEqual([{ id: 'l' }]);
    expect(GET).toHaveBeenNthCalledWith(
      1,
      '/v1/orgs/{orgId}/bid-board',
      expect.objectContaining({ params: { path: { orgId: 'org_1' } } }),
    );
  });

  it('maps company ids to names', async () => {
    const GET = vi.fn().mockResolvedValue(ok({ data: [{ id: 'a', name: 'Tiles A' }] }));
    const names = await companyNames({ GET } as unknown as ApiClient, 'org_1');
    expect(names.get('a')).toBe('Tiles A');
  });
});
