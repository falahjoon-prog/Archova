// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { BidderLists } = await import('../screens/BidderLists');
const { listCandidates, listsFor } = await import('../lib/types');

const L = '/v1/orgs/{orgId}/bidder-lists';
const company = (id: string, name: string) => ({
  id,
  name,
  type: 'subcontractor',
  trades: ['Tiling'],
  isOwnCompany: false,
});
const list = {
  id: 'bdl_1',
  name: 'Usual tilers',
  trade: 'Tiling',
  companyIds: ['cmp_a'],
  createdAt: '2026-11-05T00:00:00Z',
  updatedAt: '2026-11-05T00:00:00Z',
  version: 1,
};

beforeEach(() => {
  fake.reset();
  fake.on('GET', L, () => ({ data: [list] }));
  fake.on('GET', '/v1/orgs/{orgId}/companies', () => ({
    data: [company('cmp_a', 'Tiles A'), company('cmp_b', 'Tiles B')],
    nextCursor: null,
  }));
});

describe('list helpers', () => {
  const lists = [
    { id: '1', name: 'B list', trade: 'Electrical', companyIds: ['x'] },
    { id: '2', name: 'A list', trade: 'Tiling', companyIds: ['x', 'y', 'z'] },
  ];
  it('puts lists for the package trade first', () => {
    expect(listsFor(lists, 'tiling').map((l) => l.id)).toEqual(['2', '1']);
  });
  it('keeps only companies that can be invited now', () => {
    expect(listCandidates(lists[1]!, ['y', 'q'])).toEqual(['y']);
  });
});

describe('BidderLists', () => {
  it('shows each list with its trade and company count', async () => {
    renderInProject(<BidderLists />);
    expect(await screen.findByText('Usual tilers')).toBeTruthy();
    expect(screen.getByText(/Tiling · 1 company/)).toBeTruthy();
  });

  it('saves a new list with the ticked companies', async () => {
    const user = userEvent.setup();
    fake.on('POST', L, (init) => ({ ...list, id: 'bdl_2', ...(init.body as object) }));
    renderInProject(<BidderLists />);
    await screen.findByText('Usual tilers');
    await user.click(screen.getByRole('button', { name: /New list/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Floors');
    await user.type(within(dialog).getByLabelText('Trade'), 'Tiling');
    await user.click(await within(dialog).findByLabelText('Tiles B'));
    await user.click(within(dialog).getByRole('button', { name: 'Save list' }));
    await vi.waitFor(() => {
      const call = fake.calls.find((c) => c.method === 'POST' && c.path === L);
      expect(call?.init.body).toEqual({ name: 'Floors', trade: 'Tiling', companyIds: ['cmp_b'] });
    });
  });

  it('deletes a list', async () => {
    const user = userEvent.setup();
    fake.on('DELETE', `${L}/{bidderListId}`, () => ({}));
    renderInProject(<BidderLists />);
    await screen.findByText('Usual tilers');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await vi.waitFor(() =>
      expect(
        fake.calls.some((c) => c.method === 'DELETE' && c.path === `${L}/{bidderListId}`),
      ).toBe(true),
    );
  });
});
