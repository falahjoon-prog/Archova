import { describe, expect, it } from 'vitest';
import type { ApiClient } from '@archova/api-client';
import { classifyFailure, SyncHttpError, projectScope, ORG_SCOPE } from '@archova/sync-core';
import { createSyncTransport } from '../lib/sync/transport';
import { deviceScopes } from '../lib/sync/scopes';

type Call = { method: 'GET' | 'POST'; path: string; init: unknown };

function fakeApi(respond: (call: Call) => Response | Promise<Response> | Error) {
  const calls: Call[] = [];
  const handle = (method: Call['method']) => async (path: string, init: unknown) => {
    const call = { method, path, init };
    calls.push(call);
    const out = await respond(call);
    if (out instanceof Error) throw out;
    const text = await out.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    return out.ok ? { data: body, response: out } : { error: body, response: out };
  };
  return { api: { GET: handle('GET'), POST: handle('POST') } as unknown as ApiClient, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const mutation = {
  mutationId: 'm1',
  command: 'defects.create',
  entityId: 'd1',
  baseVersion: null,
  clientAt: '2026-10-28T00:00:00.000Z',
  payload: { projectId: 'p1' },
};

describe('createSyncTransport', () => {
  it('pulls with the scopes in one parameter', async () => {
    const page = { changes: [], revokedScopes: [], nextSince: '5', hasMore: false };
    const { api, calls } = fakeApi(() => json(200, page));
    const out = await createSyncTransport(api, 'org1').pull({
      scopes: [projectScope('p1', 'defects'), projectScope('p1', 'diary'), ORG_SCOPE],
      since: '0',
      limit: 500,
    });
    expect(out).toEqual(page);
    expect(calls[0]).toMatchObject({
      path: '/v1/orgs/{orgId}/sync/pull',
      init: {
        params: {
          path: { orgId: 'org1' },
          query: { scopes: 'project:p1:defects,diary;org', since: '0', limit: 500 },
        },
      },
    });
  });

  it('maps every push status, filling in a missing problem', async () => {
    const { api } = fakeApi(() =>
      json(200, {
        results: [
          { mutationId: 'a', status: 'applied', version: 3 },
          { mutationId: 'b', status: 'conflict', version: 4, server: { title: 'x' } },
          { mutationId: 'c', status: 'rejected', problem: { code: 'file.blocked' } },
          { mutationId: 'd', status: 'rejected' },
          { mutationId: 'e', status: 'pending_review' },
        ],
      }),
    );
    const out = await createSyncTransport(api, 'org1').push(
      { mutations: [mutation] },
      { drain: false },
    );
    expect(out.results).toEqual([
      { mutationId: 'a', status: 'applied', version: 3 },
      { mutationId: 'b', status: 'conflict', version: 4, server: { title: 'x' } },
      { mutationId: 'c', status: 'rejected', problem: { code: 'file.blocked' } },
      { mutationId: 'd', status: 'rejected', problem: { code: 'rejected' } },
      { mutationId: 'e', status: 'pending_review' },
    ]);
  });

  it('turns failures into SyncHttpError the engine can classify', async () => {
    const run = async (respond: () => Response | Error) => {
      const { api } = fakeApi(respond);
      return createSyncTransport(api, 'org1', () => 0)
        .push({ mutations: [mutation] }, { drain: false })
        .catch((e: unknown) => e);
    };
    const offline = await run(() => new TypeError('Network request failed'));
    expect(offline).toBeInstanceOf(SyncHttpError);
    expect(classifyFailure(offline)).toBe('retry');

    const upgrade = await run(() => json(426, { code: 'app.upgrade_required' }));
    expect(classifyFailure(upgrade)).toBe('upgrade');

    const signedOut = await run(() => json(401, { code: 'auth.unauthenticated' }));
    expect(classifyFailure(signedOut)).toBe('auth');

    // The endpoints answer 501 until the handlers are built: queued work waits and retries, never lost.
    const notBuilt = await run(() => json(501, { code: 'not_implemented' }));
    expect(classifyFailure(notBuilt)).toBe('retry');
  });

  it('carries Retry-After on a throttled pull', async () => {
    const { api } = fakeApi(() => json(429, { code: 'rate_limited' }, { 'Retry-After': '7' }));
    const error = await createSyncTransport(api, 'org1', () => 0)
      .pull({ scopes: [ORG_SCOPE], since: '0', limit: 500 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 429, retryAfterMs: 7000 });
  });

  it('refuses a drain push until the contract carries the drain grant', async () => {
    const { api, calls } = fakeApi(() => json(200, { results: [] }));
    const error = await createSyncTransport(api, 'org1')
      .push({ mutations: [mutation] }, { drain: true })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 501, code: 'not_implemented' });
    expect(calls).toHaveLength(0);
  });
});

describe('deviceScopes', () => {
  it('keeps the org and the offline modules of every project', async () => {
    const { api } = fakeApi(() =>
      json(200, { data: [{ id: 'p1' }, { id: 'p2' }], nextCursor: null }),
    );
    const scopes = await deviceScopes(api, 'org1');
    expect(scopes).toContainEqual(ORG_SCOPE);
    expect(scopes).toContainEqual(projectScope('p2', 'diary'));
    expect(scopes).toHaveLength(1 + 2 * 3);
  });
});
