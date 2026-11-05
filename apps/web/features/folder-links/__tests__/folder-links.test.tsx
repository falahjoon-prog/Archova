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

const { FoldersScreen } = await import('../screens/FoldersScreen');
const { FolderLinksScreen } = await import('../screens/FolderLinksScreen');
const { FoldersCallbackScreen, RETURN_KEY } = await import('../screens/FoldersCallbackScreen');

const C = '/v1/orgs/{orgId}/folder-connections';
const P = `${C}/{provider}`;
const L = '/v1/orgs/{orgId}/projects/{projectId}/folder-links';
const conn = (provider: string, status = 'active') => ({
  id: 'fcn_1',
  provider,
  status,
  tenantId: null,
  lastError: null,
  updatedAt: '2026-11-05T00:00:00Z',
});
const link = {
  id: 'fln_1',
  projectId: 'prj_test',
  provider: 'google',
  folderName: 'Archova - Tower A',
  webUrl: 'https://drive.example/f',
  status: 'active',
  lastError: null,
  lastPublishedAt: '2026-11-05T01:00:00Z',
  createdAt: '2026-11-05T00:00:00Z',
};

beforeEach(() => fake.reset());

describe('FoldersScreen', () => {
  it('says so when no provider is set up on this installation', async () => {
    fake.on('GET', C, () => ({ data: [], available: [] }));
    renderInProject(<FoldersScreen />);
    expect(await screen.findByText('SharePoint and Google Drive are not set up yet')).toBeTruthy();
  });

  it('needs a tenant for Microsoft and sends the browser to the consent address', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, configurable: true });
    window.sessionStorage.clear();
    fake.on('GET', C, () => ({ data: [], available: ['m365'] }));
    fake.on('POST', `${P}/connect`, () => ({
      url: 'https://login.microsoftonline.com/x/adminconsent',
    }));
    const user = userEvent.setup();
    renderInProject(<FoldersScreen />);
    const button = await screen.findByRole('button', {
      name: 'Connect Microsoft 365 (SharePoint)',
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await enterText(user, screen.getByLabelText(/Microsoft tenant id/), 'contoso.com');
    await user.click(button);
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(fake.calls.find((c) => c.method === 'POST')?.init.body).toEqual({
      tenantId: 'contoso.com',
    });
    expect(JSON.parse(window.sessionStorage.getItem(RETURN_KEY)!)).toMatchObject({
      orgSlug: 'acme',
    });
  });

  it('asks twice before disconnecting', async () => {
    fake.on('GET', C, () => ({ data: [conn('google')], available: ['google'] }));
    fake.on('DELETE', P, () => null);
    const user = userEvent.setup();
    renderInProject(<FoldersScreen />);
    await user.click(await screen.findByRole('button', { name: /^Disconnect Google Drive/ }));
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, disconnect' }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('FolderLinksScreen', () => {
  it('points to settings when nothing is connected', async () => {
    fake.on('GET', C, () => ({ data: [], available: ['google'] }));
    fake.on('GET', L, () => ({ data: [] }));
    renderInProject(<FolderLinksScreen />);
    expect(await screen.findByText('Connect SharePoint or Google Drive first')).toBeTruthy();
    expect(screen.getByText('Not published anywhere yet')).toBeTruthy();
  });

  it('shows publish status and what went wrong', async () => {
    fake.on('GET', C, () => ({ data: [conn('google')], available: ['google'] }));
    fake.on('GET', L, () => ({
      data: [
        {
          ...link,
          status: 'error',
          lastError: 'Google Drive refused access. An admin must reconnect it.',
        },
      ],
    }));
    renderInProject(<FolderLinksScreen />);
    expect(await screen.findByText('Archova - Tower A')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText(/refused access/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open folder' })).toBeTruthy();
  });

  it('links a SharePoint folder by its address', async () => {
    fake.on('GET', C, () => ({ data: [conn('m365')], available: ['m365'] }));
    fake.on('GET', L, () => ({ data: [] }));
    fake.on('POST', L, () => ({ ...link, provider: 'm365' }));
    const user = userEvent.setup();
    renderInProject(<FolderLinksScreen />);
    const go = await screen.findByRole('button', { name: 'Start publishing' });
    expect((go as HTMLButtonElement).disabled).toBe(true);
    await enterText(
      user,
      screen.getByLabelText(/SharePoint folder address/),
      'https://x.sharepoint.com/f',
    );
    await user.click(go);
    await waitFor(() =>
      expect(fake.calls.find((c) => c.method === 'POST')?.init.body).toEqual({
        provider: 'm365',
        url: 'https://x.sharepoint.com/f',
      }),
    );
  });

  it('creates a Drive folder with no address', async () => {
    fake.on('GET', C, () => ({ data: [conn('google')], available: ['google'] }));
    fake.on('GET', L, () => ({ data: [] }));
    fake.on('POST', L, () => link);
    const user = userEvent.setup();
    renderInProject(<FolderLinksScreen />);
    await user.click(await screen.findByRole('button', { name: 'Start publishing' }));
    await waitFor(() =>
      expect(fake.calls.find((c) => c.method === 'POST')?.init.body).toEqual({
        provider: 'google',
      }),
    );
  });

  it('asks twice before stopping a link', async () => {
    fake.on('GET', C, () => ({ data: [conn('google')], available: ['google'] }));
    fake.on('GET', L, () => ({ data: [link] }));
    fake.on('DELETE', `${L}/{linkId}`, () => null);
    const user = userEvent.setup();
    renderInProject(<FolderLinksScreen />);
    await user.click(await screen.findByRole('button', { name: 'Stop publishing' }));
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, stop publishing' }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('FoldersCallbackScreen', () => {
  it('finishes a Microsoft consent, which has a state and no code', async () => {
    window.sessionStorage.setItem(RETURN_KEY, JSON.stringify({ orgId: 'org_1', orgSlug: 'acme' }));
    nav.search = '?state=st&tenant=t1&admin_consent=True';
    replaced.length = 0;
    fake.on('POST', `${P}/callback`, () => conn('m365'));
    render(<FoldersCallbackScreen provider="m365" />);
    await waitFor(() => expect(replaced.length).toBeGreaterThan(0));
    expect(fake.calls[0]?.init.body).toEqual({ state: 'st' });
    expect(replaced[0]).toContain('/acme/settings/folders');
  });

  it('explains when the admin declined', async () => {
    window.sessionStorage.setItem(RETURN_KEY, JSON.stringify({ orgId: 'org_1', orgSlug: 'acme' }));
    nav.search = '?state=st&error=access_denied';
    render(<FoldersCallbackScreen provider="m365" />);
    expect(await screen.findByText('This sign-in did not finish')).toBeTruthy();
  });
});
