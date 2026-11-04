// @vitest-environment jsdom
import { screen, waitFor, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, nav, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const replaced = vi.hoisted(() => [] as string[]);
vi.mock('next/navigation', async () => {
  const base = (await import('@/test/render')).navigationMock;
  return {
    ...base,
    useRouter: () => ({ ...base.useRouter(), replace: (h: string) => replaced.push(h) }),
  };
});

const { AccountingScreen } = await import('../screens/AccountingScreen');
const { AccountingCallbackScreen, RETURN_KEY } =
  await import('../screens/AccountingCallbackScreen');

const C = '/v1/orgs/{orgId}/accounting/connections';
const P = `${C}/{provider}`;
const connection = {
  id: 'acn_1',
  provider: 'xero',
  status: 'active',
  targetName: 'Harbour Builders Pty Ltd',
  fieldMap: { accounts: { '03.100': { accountRef: '300', taxRef: 'INPUT2' } }, retention: null },
  settings: { startDate: null, pushBills: true, pushInvoices: true, billStatus: 'draft' },
  lastError: null,
  lastPulledAt: null,
};

beforeEach(() => {
  fake.reset();
  fake.on('GET', '/v1/orgs/{orgId}/accounting/sync-issues', () => ({ data: [] }));
});

describe('AccountingScreen', () => {
  it('says so when no provider is set up on this installation', async () => {
    fake.on('GET', C, () => ({ data: [], available: [] }));
    renderInProject(<AccountingScreen />);
    expect(await screen.findByText('Xero and MYOB are not set up yet')).toBeTruthy();
  });

  it('sends the browser to the provider and remembers where to come back to', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, configurable: true });
    window.sessionStorage.clear();
    fake.on('GET', C, () => ({ data: [], available: ['xero'] }));
    fake.on('POST', `${P}/connect`, () => ({ url: 'https://login.xero.com/authorize?state=s' }));
    const user = userEvent.setup();
    renderInProject(<AccountingScreen />);
    await user.click(await screen.findByRole('button', { name: 'Connect Xero' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://login.xero.com/authorize?state=s'),
    );
    expect(JSON.parse(window.sessionStorage.getItem(RETURN_KEY)!)).toMatchObject({
      orgSlug: 'acme',
    });
  });

  it('lets the admin pick the organisation when the account reaches several', async () => {
    fake.on('GET', C, () => ({
      data: [{ ...connection, status: 'needs_target', targetName: null }],
      available: ['xero'],
    }));
    fake.on('GET', `${P}/targets`, () => ({
      data: [
        { ref: 'a', name: 'Alpha' },
        { ref: 'b', name: 'Beta' },
      ],
    }));
    fake.on('PUT', `${P}/targets`, () => connection);
    const user = userEvent.setup();
    renderInProject(<AccountingScreen />);
    await user.selectOptions(await screen.findByLabelText('Xero organisation'), 'b');
    await user.click(screen.getByRole('button', { name: 'Use this one' }));
    await waitFor(() =>
      expect(fake.calls.find((c) => c.method === 'PUT')?.init.body).toEqual({
        ref: 'b',
        name: 'Beta',
      }),
    );
  });

  it('saves the cost-code map with the retention account, and refuses a half-filled row', async () => {
    fake.on('GET', C, () => ({ data: [connection], available: ['xero'] }));
    fake.on('PUT', `${P}/field-map`, () => connection);
    const user = userEvent.setup();
    renderInProject(<AccountingScreen />);
    await screen.findByDisplayValue('03.100');

    await user.click(screen.getByRole('button', { name: 'Save the map' }));
    expect(await screen.findByText('Choose the retention account and its tax code.')).toBeTruthy();

    await enterText(user, screen.getByLabelText('Retention account'), '820');
    await enterText(user, screen.getByLabelText('Retention tax code'), 'NONE');
    await user.click(screen.getByRole('button', { name: 'Save the map' }));
    await waitFor(() =>
      expect(fake.calls.find((c) => c.method === 'PUT')?.init.body).toEqual({
        accounts: { '03.100': { accountRef: '300', taxRef: 'INPUT2' } },
        retention: { accountRef: '820', taxRef: 'NONE' },
      }),
    );
  });

  it('lists sync issues and marks one dealt with', async () => {
    fake.on('GET', C, () => ({ data: [connection], available: ['xero'] }));
    fake.on('GET', '/v1/orgs/{orgId}/accounting/sync-issues', () => ({
      data: [
        {
          id: 'syi_1',
          provider: 'xero',
          kind: 'remote_locked',
          reference: 'PC-SC1-1',
          message: 'PC-SC1-1 is already authorised in the accounting system.',
          status: 'open',
          createdAt: '2026-10-31T00:00:00Z',
        },
      ],
    }));
    fake.on('POST', '/v1/orgs/{orgId}/accounting/sync-issues/{syncIssueId}/resolve', () => ({}));
    const user = userEvent.setup();
    renderInProject(<AccountingScreen />);
    expect(await screen.findByText(/Already approved in the accounting system/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Mark as dealt with' }));
    await waitFor(() => expect(fake.calls.some((c) => c.path.endsWith('/resolve'))).toBe(true));
  });

  it('asks twice before disconnecting', async () => {
    fake.on('GET', C, () => ({ data: [connection], available: ['xero'] }));
    fake.on('DELETE', P, () => null);
    const user = userEvent.setup();
    renderInProject(<AccountingScreen />);
    await user.click(await screen.findByRole('button', { name: 'Disconnect Xero' }));
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, disconnect Xero' }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('AccountingCallbackScreen', () => {
  it('finishes the sign-in and returns to the settings page', async () => {
    window.sessionStorage.setItem(RETURN_KEY, JSON.stringify({ orgId: 'org_1', orgSlug: 'acme' }));
    nav.search = '?code=abc&state=st';
    replaced.length = 0;
    fake.on('POST', `${P}/callback`, () => connection);
    render(<AccountingCallbackScreen provider="xero" />);
    await waitFor(() => expect(replaced.length).toBeGreaterThan(0));
    expect(fake.calls[0]?.init.body).toEqual({ code: 'abc', state: 'st' });
    expect(replaced[0]).toContain('/acme/settings/accounting');
    expect(window.sessionStorage.getItem(RETURN_KEY)).toBeNull();
  });

  it('explains when the link has no code or the org was forgotten', async () => {
    window.sessionStorage.clear();
    nav.search = '';
    render(<AccountingCallbackScreen provider="myob" />);
    expect(await screen.findByText('This sign-in link is no longer valid')).toBeTruthy();
  });
});
