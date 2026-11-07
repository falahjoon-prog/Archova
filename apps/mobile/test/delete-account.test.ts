import { describe, expect, it } from 'vitest';
import { authorizeUrl } from '@archova/auth-client';
import { deleteAccount, type DeleteMeResult } from '../lib/auth/delete-account';

const reply = (status: number, error?: unknown): (() => Promise<DeleteMeResult>) => {
  return async () => ({ response: { ok: status < 300, status }, error });
};

describe('deleteAccount', () => {
  it('reports a deleted account on 204', async () => {
    expect(await deleteAccount(reply(204))).toEqual({ status: 'deleted' });
  });

  it('asks for a fresh sign-in when the last one is too old', async () => {
    expect(await deleteAccount(reply(403, { code: 'auth.step_up_required' }))).toEqual({
      status: 'needs_recent_sign_in',
    });
  });

  it('lists the organisations that still need an owner', async () => {
    const outcome = await deleteAccount(
      reply(409, {
        code: 'account.sole_owner',
        orgs: [{ id: 'org_1', name: 'Harbour Build' }, { nope: 1 }],
      }),
    );
    expect(outcome).toEqual({
      status: 'sole_owner',
      orgs: [{ id: 'org_1', name: 'Harbour Build' }],
    });
  });

  it('reports a platform hold', async () => {
    expect(await deleteAccount(reply(409, { code: 'account.org_on_hold' }))).toEqual({
      status: 'org_on_hold',
    });
  });

  it('gives a plain message for other failures and for no signal', async () => {
    expect((await deleteAccount(reply(500, { code: 'internal' }))).status).toBe('error');
    const offline = await deleteAccount(async () => {
      throw new Error('Network request failed');
    });
    expect(offline.status).toBe('error');
  });
});

describe('authorizeUrl', () => {
  it('adds prompt=login only when asked', () => {
    const base = { challenge: 'c', state: 's' };
    expect(authorizeUrl('https://app.example', base)).not.toContain('prompt=');
    expect(authorizeUrl('https://app.example', { ...base, prompt: 'login' })).toContain(
      'prompt=login',
    );
  });
});
