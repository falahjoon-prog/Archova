// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enterText, renderInProject } from '@/test/render';

const fake = await vi.hoisted(async () => (await import('@/test/fake-api')).createFakeApi());
vi.mock('@/shared/lib/api', () => fake.module);

const { ApiAccessScreen } = await import('../screens/ApiAccessScreen');
const { fakeProblem } = await import('@/test/fake-api');

const T = '/v1/orgs/{orgId}/api-tokens';
const W = '/v1/orgs/{orgId}/webhooks';
const token = {
  id: 'tok_1',
  userId: 'usr_1',
  name: 'Data warehouse',
  prefix: 'pk_live_ab12',
  scopes: ['rfis:read'],
  expiresAt: '2027-01-28T00:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-10-30T00:00:00Z',
};

beforeEach(() => {
  fake.reset();
  fake.on('GET', '/v1/auth/session', () => ({
    user: { id: 'usr_1', email: 'dana@acme.test', name: 'Dana' },
    csrfToken: 'x',
    expiresAt: '2026-11-30T00:00:00Z',
  }));
  fake.on('GET', T, () => ({ data: [token], availableScopes: ['rfis:read', 'rfis:write'] }));
  fake.on('GET', W, () => ({ data: [], availableEventTypes: ['rfis.rfi.created.v1'] }));
});

describe('ApiAccessScreen', () => {
  it('lists tokens without their secret and revokes one', async () => {
    const user = userEvent.setup();
    fake.on('DELETE', `${T}/{apiTokenId}`, () => undefined);
    renderInProject(<ApiAccessScreen />);
    expect(await screen.findByText('Data warehouse')).toBeTruthy();
    expect(screen.getByText(/never used/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Revoke Data warehouse' }));
    await waitFor(() => expect(fake.callsTo('DELETE', `${T}/{apiTokenId}`)).toHaveLength(1));
  });

  it('creates a token and shows the secret once', async () => {
    const user = userEvent.setup();
    fake.on('POST', T, (init) => ({
      ...token,
      id: 'tok_2',
      token: 'pk_live_SECRET',
      ...(init.body as object),
    }));
    renderInProject(<ApiAccessScreen />);
    await enterText(user, await screen.findByLabelText('Token name'), 'Reporting');
    await user.click(screen.getByLabelText('rfis · write'));
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByText('pk_live_SECRET')).toBeTruthy();
    expect(fake.callsTo('POST', T)[0]!.init.body).toEqual({
      name: 'Reporting',
      scopes: ['rfis:write'],
    });
    await user.click(screen.getByRole('button', { name: 'I have saved it' }));
    expect(screen.queryByText('pk_live_SECRET')).toBeNull();
  });

  it('asks for the password when the sign-in is not recent, then creates the token', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    fake.on('POST', T, () =>
      ++attempts === 1
        ? fakeProblem(403, 'auth.step_up_required')
        : { ...token, token: 'pk_live_AFTER' },
    );
    fake.on('POST', '/v1/auth/login', () => ({ user: {}, csrfToken: 'x', expiresAt: '' }));
    renderInProject(<ApiAccessScreen />);
    await enterText(user, await screen.findByLabelText('Token name'), 'Reporting');
    await user.click(screen.getByLabelText('rfis · read'));
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    await enterText(user, await screen.findByLabelText('Password'), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: 'Confirm and create token' }));
    expect(await screen.findByText('pk_live_AFTER')).toBeTruthy();
    expect(fake.callsTo('POST', '/v1/auth/login')[0]!.init.body).toEqual({
      email: 'dana@acme.test',
      password: 'hunter2hunter2',
    });
  });

  it('tells members that webhooks are for owners and admins', async () => {
    fake.on('GET', W, () => fakeProblem(403, 'access.denied'));
    renderInProject(<ApiAccessScreen />);
    expect(await screen.findByText('Only owners and admins can manage webhooks.')).toBeTruthy();
  });

  it('adds a webhook and shows its signing secret once', async () => {
    const user = userEvent.setup();
    fake.on('POST', W, () => ({
      id: 'whk_1',
      url: 'https://hooks.example.com/a',
      description: null,
      eventTypes: ['rfis.rfi.created.v1'],
      projectIds: null,
      status: 'active',
      disabledReason: null,
      createdAt: '2026-10-30T00:00:00Z',
      secret: 'whsec_SECRET',
    }));
    renderInProject(<ApiAccessScreen />);
    await enterText(
      user,
      await screen.findByLabelText('Webhook address'),
      'https://hooks.example.com/a',
    );
    await user.click(screen.getByLabelText('rfis.rfi.created.v1'));
    await user.click(screen.getByRole('button', { name: 'Add webhook' }));
    expect(await screen.findByText('whsec_SECRET')).toBeTruthy();
    expect(fake.callsTo('POST', W)[0]!.init.body).toEqual({
      url: 'https://hooks.example.com/a',
      eventTypes: ['rfis.rfi.created.v1'],
    });
  });
});
