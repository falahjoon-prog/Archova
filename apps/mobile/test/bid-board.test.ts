import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@archova/api-client';
import { mobileRoutes } from '@archova/routes';
import {
  boardSubtitle,
  buildQuote,
  cleanAmount,
  getProjectPackage,
  listMyQuotes,
  listProjectPackages,
  moneyText,
  packageSubtitle,
  submitQuote,
  companyNames,
  dueLine,
  getBidBoard,
  listBidderLists,
  listSubtitle,
  lowestText,
  responseText,
} from '../features/bid-board';

vi.mock('../features/bid-board/screens/BidBoardScreen', () => ({}));
vi.mock('../features/bid-board/screens/ProjectPackagesScreen', () => ({}));
vi.mock('../features/bid-board/screens/QuotePackageScreen', () => ({}));

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

describe('quoting from the phone', () => {
  const scope = [
    { key: 'floor', description: 'Floor tiles', quantity: '120', unit: 'm2' },
    { key: 'wall', description: 'Wall tiles', quantity: null, unit: 'm2' },
  ];
  const draft = { amounts: {}, lumpSum: '', reference: '', notes: '' };
  const ok = (data: unknown) => ({ data, response: { ok: true } });

  it('cleans a typed price', () => {
    expect(cleanAmount('$12,500.5')).toBe('12500.50');
    expect(cleanAmount(' 900 ')).toBe('900.00');
    expect(cleanAmount('12.345')).toBeNull();
    expect(cleanAmount('abc')).toBeNull();
    expect(moneyText(1250050)).toBe('$12,500.50');
  });

  it('builds lines from the scope prices, leaving blanks out', () => {
    const q = buildQuote(scope, {
      ...draft,
      amounts: { floor: '6,000', wall: '' },
      lumpSum: '500',
      reference: ' Q-17 ',
      notes: 'No scaffold\n\n Rock excluded ',
    });
    expect(q).toEqual({
      ok: true,
      totalCents: 650000,
      body: {
        reference: 'Q-17',
        lines: [
          {
            scopeKey: 'floor',
            description: 'Floor tiles',
            quantity: '120',
            unit: 'm2',
            amount: '6000.00',
          },
          { description: 'Other work', amount: '500.00' },
        ],
        qualifications: [{ text: 'No scaffold' }, { text: 'Rock excluded' }],
      },
    });
  });

  it('refuses a bad or missing price', () => {
    expect(buildQuote(scope, draft)).toEqual({ ok: false, problem: 'Enter at least one price.' });
    expect(buildQuote(scope, { ...draft, amounts: { floor: 'lots' } })).toMatchObject({
      ok: false,
      problem: expect.stringContaining('Floor tiles'),
    });
    expect(buildQuote([], { ...draft, lumpSum: '9000' })).toMatchObject({
      ok: true,
      body: { lines: [{ description: 'Lump sum', amount: '9000.00' }] },
    });
  });

  it('describes a package', () => {
    expect(packageSubtitle({ trade: 'Tiling', status: 'out_to_tender', dueAt: null })).toBe(
      'Tiling. Open for quotes. No due date',
    );
  });

  it('reads packages and sends the quote with one idempotency key', async () => {
    const GET = vi
      .fn()
      .mockResolvedValueOnce(ok({ data: [{ id: 'tpk_1' }] }))
      .mockResolvedValueOnce(ok({ id: 'tpk_1' }))
      .mockResolvedValueOnce(ok({ data: [{ id: 'quo_1' }] }));
    const POST = vi.fn().mockResolvedValue(ok({ id: 'quo_2' }));
    const api = { GET, POST } as unknown as ApiClient;
    const t = { orgId: 'org_1', projectId: 'prj_1', packageId: 'tpk_1' };
    expect(await listProjectPackages(api, t)).toEqual([{ id: 'tpk_1' }]);
    expect((await getProjectPackage(api, t)).id).toBe('tpk_1');
    expect(await listMyQuotes(api, t)).toEqual([{ id: 'quo_1' }]);
    await submitQuote(api, t, {
      body: { lines: [{ description: 'x', amount: '1.00' }] },
      idempotencyKey: 'k1',
    });
    expect(POST).toHaveBeenCalledWith(
      '/v1/orgs/{orgId}/projects/{projectId}/tender-packages/{packageId}/quotes',
      expect.objectContaining({
        params: expect.objectContaining({ header: { 'Idempotency-Key': 'k1' } }),
      }),
    );
  });

  it('has routes for the tenders', () => {
    expect(mobileRoutes.tenders('prj_1')).toBe('/project/prj_1/tenders');
    expect(mobileRoutes.tender('prj_1', 'tpk_1')).toBe('/project/prj_1/tenders/tpk_1');
  });
});
