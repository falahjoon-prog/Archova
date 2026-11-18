// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);
const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', async () => {
  const base = (await import('@/test/render')).navigationMock;
  return { ...base, useSearchParams: () => new URLSearchParams(search.value) };
});
const me = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'member',
}));
vi.mock('@/features/orgs', () => ({
  useMe: () => ({
    isPending: false,
    isError: false,
    data: {
      memberships: [
        {
          orgId: 'org_owner',
          orgName: 'Acme Builders',
          orgSlug: 'acme',
          role: me.role,
          kind: 'member',
        },
      ],
    },
  }),
}));

const { AppsScreen } = await import('../screens/AppsScreen');
const { ConsentScreen } = await import('../screens/ConsentScreen');
const { fakeProblem } = await import('@/test/fake-api');

const APPS = '/v1/orgs/{orgId}/oauth-apps';
const INSTALLS = '/v1/orgs/{orgId}/app-installs';
const CONSENT = '/v1/oauth/consent';
const app = {
  clientId: 'app_0123456789abcdef01234567',
  name: 'Site Safety Co',
  description: null,
  redirectUris: ['https://partner.example.com/cb'],
  scopes: ['projects:read'],
  disabled: false,
};
const install = {
  id: 'ain_1',
  clientId: app.clientId,
  appName: 'Site Safety Co',
  scopes: ['projects:read'],
  installedBy: 'usr_1',
  createdAt: '2026-11-05T00:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
};

beforeEach(() => {
  fake.reset();
  me.role = 'admin';
  fake.on('GET', '/v1/auth/session', () => ({
    user: { id: 'usr_1', email: 'dana@acme.test', name: 'Dana' },
  }));
});

describe('AppsScreen', () => {
  it('lists installed apps and removes one after confirmation', async () => {
    const user = userEvent.setup();
    let installs = [install];
    fake.on('GET', INSTALLS, () => ({ data: installs }));
    fake.on('GET', APPS, () => ({ data: [app], availableScopes: ['projects:read', 'rfis:read'] }));
    fake.on('DELETE', `${INSTALLS}/{appInstallId}`, () => {
      installs = [];
      return undefined;
    });
    renderInProject(<AppsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Remove Site Safety Co' }));
    await user.click(screen.getByRole('button', { name: 'Yes, remove Site Safety Co' }));
    expect(await screen.findByText('No apps are installed.')).toBeTruthy();
  });

  it('registers an app and shows its secret once', async () => {
    const user = userEvent.setup();
    fake.on('GET', INSTALLS, () => ({ data: [] }));
    fake.on('GET', APPS, () => ({ data: [], availableScopes: ['projects:read', 'rfis:read'] }));
    fake.on('POST', APPS, (init) => ({
      ...app,
      ...(init.body as object),
      clientSecret: 'cs_SECRET',
    }));
    renderInProject(<AppsScreen />);
    await enterText(user, await screen.findByLabelText('App name'), 'Site Safety Co');
    await enterText(
      user,
      screen.getByLabelText('Redirect address'),
      'https://partner.example.com/cb',
    );
    await user.click(screen.getByLabelText('projects · read'));
    await user.click(screen.getByRole('button', { name: 'Register app' }));
    expect(await screen.findByText('cs_SECRET')).toBeTruthy();
    expect(fake.callsTo('POST', APPS)[0]!.init.body).toEqual({
      name: 'Site Safety Co',
      redirectUris: ['https://partner.example.com/cb'],
      scopes: ['projects:read'],
    });
    await user.click(screen.getByRole('button', { name: 'I have saved it' }));
    expect(screen.queryByText('cs_SECRET')).toBeNull();
  });
});

describe('ConsentScreen', () => {
  const consent = {
    clientId: app.clientId,
    name: 'Site Safety Co',
    description: 'Safety walks',
    ownerOrgId: 'org_owner',
    scopes: ['projects:read', 'rfis:write'],
  };
  const query = (extra = '') =>
    `client_id=${app.clientId}&redirect_uri=${encodeURIComponent('https://partner.example.com/cb')}&code_challenge=${'a'.repeat(43)}&state=st${extra}`;

  it('shows what the app may do and sends the browser back with the code on approval', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, configurable: true });
    search.value = query();
    fake.on('GET', CONSENT, () => consent);
    fake.on('POST', INSTALLS, () => ({
      redirectUrl: 'https://partner.example.com/cb?code=c1&state=st',
    }));
    const user = userEvent.setup();
    renderInProject(<ConsentScreen />);
    expect(await screen.findByText('Allow Site Safety Co?')).toBeTruthy();
    expect(screen.getByText('Read projects')).toBeTruthy();
    expect(screen.getByText('Read and change rfis')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://partner.example.com/cb?code=c1&state=st'),
    );
    expect(fake.callsTo('POST', INSTALLS)[0]!.init.body).toMatchObject({
      clientId: app.clientId,
      state: 'st',
      scopes: ['projects:read', 'rfis:write'],
    });
  });

  it('cancel returns access_denied to the app', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { assign }, configurable: true });
    search.value = query();
    fake.on('GET', CONSENT, () => consent);
    const user = userEvent.setup();
    renderInProject(<ConsentScreen />);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(assign).toHaveBeenCalledWith(
      'https://partner.example.com/cb?error=access_denied&state=st',
    );
  });

  it('does not let a member who is not an admin approve', async () => {
    me.role = 'member';
    search.value = query();
    fake.on('GET', CONSENT, () => consent);
    renderInProject(<ConsentScreen />);
    expect(await screen.findByText("You can't approve this app")).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('asks for the password when the sign-in is not recent', async () => {
    search.value = query();
    fake.on('GET', CONSENT, () => consent);
    fake.on('POST', INSTALLS, () => fakeProblem(403, 'auth.step_up_required'));
    const user = userEvent.setup();
    renderInProject(<ConsentScreen />);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByLabelText('Password')).toBeTruthy();
  });

  it('rejects a link with missing parts', () => {
    search.value = 'client_id=x';
    renderInProject(<ConsentScreen />);
    expect(screen.getByText('This link is not valid')).toBeTruthy();
  });
});
