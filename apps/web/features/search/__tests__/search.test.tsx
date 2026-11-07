// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, navigationMock, renderInProject } from '@/test/render';

vi.mock('next/navigation', () => navigationMock);
const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', async () => {
  const { createQueries } = await import('@archova/query');
  return { ...fake.module, queries: createQueries(fake.module.api as never) };
});

const { SearchScreen } = await import('../screens/SearchScreen');
const SEARCH = '/v1/orgs/{orgId}/search';

describe('SearchScreen', () => {
  beforeEach(() => {
    fake.reset();
    nav.search = '';
  });

  it('does not search for one character', async () => {
    const calls = vi.fn(() => ({ query: '', results: [], truncated: false }));
    fake.on('GET', SEARCH, calls);
    renderInProject(<SearchScreen />);
    await userEvent.type(screen.getByLabelText('Search'), 'a');
    expect(calls).not.toHaveBeenCalled();
  });

  it('groups matches by kind and links each to its page', async () => {
    fake.on('GET', SEARCH, () => ({
      query: 'door',
      truncated: false,
      results: [
        {
          type: 'rfi',
          id: 'rfi_1',
          projectId: 'prj_a',
          projectName: 'Alpha Tower',
          ref: 'RFI-012',
          title: 'Fire door rating',
          status: 'open',
        },
        {
          type: 'defect',
          id: 'dfc_1',
          projectId: 'prj_b',
          projectName: 'Bravo Lofts',
          ref: 'DEF-003',
          title: 'Door closer loose',
          status: 'open',
        },
      ],
    }));
    renderInProject(<SearchScreen />);
    await userEvent.type(screen.getByLabelText('Search'), 'door');
    const rfis = await screen.findByRole('region', { name: 'RFIs' });
    const link = within(rfis).getByRole('link', { name: /RFI-012/ });
    expect(link.getAttribute('href')).toBe('/acme/projects/prj_a/rfis/rfi_1');
    expect(within(rfis).getByText('Alpha Tower')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Defects' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Documents' })).toBeNull();
  });

  it('says so when nothing matches', async () => {
    fake.on('GET', SEARCH, () => ({ query: 'zzz', results: [], truncated: false }));
    renderInProject(<SearchScreen />);
    await userEvent.type(screen.getByLabelText('Search'), 'zzz');
    expect(await screen.findByText('No matches')).toBeTruthy();
  });
});
