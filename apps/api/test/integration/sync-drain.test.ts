import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import type { TenantContext } from '@archova/kernel';
import {
  API_HOST,
  APP_HOST,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
  addMember,
  removeMember,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const TRIAL = {
  plan: 'trial',
  state: 'trialing' as const,
  modules: [] as string[],
  limits: {},
};

async function world(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const ex = await signUp(t.app, `${label}-ex`); // a person whose access has ended: no membership at all
  const org = await createOrg(pm.browser, `${label} Builders`);
  const a = await createProject(pm.browser, org.id, { name: 'Tower A', state: 'NSW' });
  const b = await createProject(pm.browser, org.id, { name: 'Tower B', state: 'NSW' });
  // Both projects had them on, and an admin took them off in the ordinary way.
  for (const p of [a, b]) {
    await addMember(
      pm.browser,
      org.id,
      p.id,
      ex.email,
      'Subcontractor',
      `${label} Formco ${p.id.slice(-4)}`,
    );
    await removeMember(pm.browser, org.id, p.id, ex.email);
  }
  const ctx: TenantContext = {
    orgId: decodeId('org', org.id)!,
    userId: decodeId('user', pm.userId)!,
    principalType: 'member',
    orgRole: 'owner',
    entitlements: TRIAL,
    requestId: 'test',
  };
  const exId = decodeId('user', ex.userId)!;
  const grant = (projectId: string | null, module: string | null = null) =>
    t.database.withTenantTx(ctx, (scope) =>
      t.modules.sync.api.drain.issue(scope, {
        userId: exId,
        projectId: projectId ? decodeId('project', projectId)! : null,
        module,
        accessEndedAt: new Date(),
      }),
    );
  const rows = (query: ReturnType<typeof sql>) =>
    t.adminDb.withTenantTx(ctx, (s) => s.tx.execute(query)).then((r) => r.rows);
  return { pm, ex, org, a, b, ctx, exId, grant, rows };
}

const send = (orgId: string, token: string, mutations: unknown[], host = API_HOST) =>
  t.app.inject({
    method: 'POST',
    url: `/v1/orgs/${orgId}/sync/push`,
    headers: { host, authorization: `Bearer ${token}` },
    payload: { mutations },
  });

const mutation = (projectId: string | undefined, over: Record<string, unknown> = {}) => ({
  mutationId: randomUUID(),
  command: 'defects.transition',
  entityId: 'dfx_00000000000000000000000000',
  ...(projectId ? { projectId } : {}),
  baseVersion: 3,
  clientAt: new Date().toISOString(),
  payload: { action: 'markReadyForReview' },
  ...over,
});

describe('drain grant (X38), queueing', () => {
  it('queues late work as pending_review without reading any record, once per mutation id', async () => {
    const w = await world('drain-queue');
    const g = (await w.grant(w.a.id))!;
    expect(g.token).toMatch(/^dg_[A-Za-z0-9_-]{43}$/);

    const m = mutation(w.a.id);
    const res = await send(w.org.id, g.token, [m]);
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([{ mutationId: m.mutationId, status: 'pending_review' }]);
    // A resend is the same row, not a second one.
    expect((await send(w.org.id, g.token, [m])).json().results[0].status).toBe('pending_review');
    expect(await w.rows(sql`select 1 from sync.late_submissions`)).toHaveLength(1);

    // The same id for a different record is refused.
    const reuse = await send(w.org.id, g.token, [
      { ...m, entityId: 'dfx_11111111111111111111111111' },
    ]);
    expect(reuse.json().results[0]).toMatchObject({
      status: 'rejected',
      problem: { code: 'validation_failed' },
    });
    expect(await w.rows(sql`select 1 from sync.late_submissions`)).toHaveLength(1);
    // The record named does not exist, yet the answer was pending_review: nothing was looked up, and nothing ran.
    expect(await w.rows(sql`select 1 from sync.mutations`)).toHaveLength(0);
  });

  it('answers a change that already went through a normal push with its stored result, and queues nothing', async () => {
    const w = await world('drain-done');
    const g = (await w.grant(w.a.id))!;
    const m = mutation(w.a.id);
    await w.rows(
      sql`insert into sync.mutations (org_id, user_id, mutation_id, command, entity_id, status, version)
          values (${w.ctx.orgId}, ${w.exId}, ${m.mutationId}, ${m.command}, ${m.entityId}, 'applied', 4)`,
    );
    const res = await send(w.org.id, g.token, [m]);
    expect(res.json().results).toEqual([
      { mutationId: m.mutationId, status: 'applied', version: 4 },
    ]);
    expect(await w.rows(sql`select 1 from sync.late_submissions`)).toHaveLength(0);
  });

  it('keeps only the hash of the token', async () => {
    const w = await world('drain-hash');
    const g = (await w.grant(w.a.id))!;
    const rows = await w.rows(sql`select token_hash, expires_at from sync.drain_grants`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toBe(createHash('sha256').update(g.token).digest('hex'));
    expect(JSON.stringify(rows)).not.toContain(g.token);
  });

  it('holds a grant to what was revoked: its project, its module, queueable commands only', async () => {
    const w = await world('drain-scope');
    const proj = (await w.grant(w.a.id))!;
    const wrongProject = await send(w.org.id, proj.token, [mutation(w.b.id)]);
    expect(wrongProject.json().results[0]).toMatchObject({
      status: 'rejected',
      problem: { code: 'access.denied' },
    });
    const noProject = await send(w.org.id, proj.token, [mutation(undefined)]);
    expect(noProject.json().results[0].problem.code).toBe('validation_failed');

    const diaryOnly = (await w.grant(w.a.id, 'diary'))!;
    const wrongModule = await send(w.org.id, diaryOnly.token, [mutation(w.a.id)]);
    expect(wrongModule.json().results[0].problem.code).toBe('access.denied');

    // Not a queueable command, or no such command: the same answer.
    for (const command of ['defects.explode', 'documents.delete']) {
      const r = await send(w.org.id, proj.token, [mutation(w.a.id, { command })]);
      expect(r.json().results[0].problem.code).toBe('validation_failed');
    }

    const org = (await w.grant(null))!;
    const both = await send(w.org.id, org.token, [mutation(w.a.id), mutation(w.b.id)]);
    expect(both.json().results.map((r: { status: string }) => r.status)).toEqual([
      'pending_review',
      'pending_review',
    ]);
    expect(await w.rows(sql`select 1 from sync.late_submissions`)).toHaveLength(2);
  });

  it('caps payloads and the queue', async () => {
    const w = await world('drain-caps');
    const g = (await w.grant(w.a.id))!;
    const big = await send(w.org.id, g.token, [
      mutation(w.a.id, { payload: { note: 'x'.repeat(300 * 1024) } }),
    ]);
    expect(big.json().results[0].problem.code).toBe('validation_failed');

    for (let i = 0; i < 5; i += 1) {
      const batch = Array.from({ length: 20 }, () => mutation(w.a.id));
      await send(w.org.id, g.token, batch);
    }
    const over = await send(w.org.id, g.token, [mutation(w.a.id)]);
    expect(over.json().results[0].problem.code).toBe('rate_limited');
    expect(await w.rows(sql`select 1 from sync.late_submissions`)).toHaveLength(100);
  });
});

describe('drain grant (X38), who can use it', () => {
  it('works on /sync/push alone, and never next to a session', async () => {
    const w = await world('drain-routes');
    const g = (await w.grant(w.a.id))!;
    const base = `/v1/orgs/${w.org.id}`;
    const headers = { host: API_HOST, authorization: `Bearer ${g.token}` };
    for (const url of [
      `${base}/sync/pull?scopes=org&since=0&limit=10`,
      `${base}/projects/${w.a.id}/defects`,
      `${base}/projects`,
      '/v1/me',
    ]) {
      const r = await t.app.inject({ method: 'GET', url, headers });
      expect(r.statusCode, url).toBe(401);
    }
    // A signed-in cookie beside the grant is refused rather than picking one.
    const withCookie = await t.app.inject({
      method: 'POST',
      url: `${base}/sync/push`,
      headers: {
        ...headers,
        cookie: [...w.pm.browser.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      payload: { mutations: [mutation(w.a.id)] },
    });
    expect(withCookie.statusCode).toBe(401);
    // The app origin only takes cookies.
    expect((await send(w.org.id, g.token, [mutation(w.a.id)], APP_HOST)).statusCode).toBe(401);
    expect(await w.rows(sql`select 1 from sync.late_submissions`)).toHaveLength(0);
  });

  it('is refused once expired, revoked, or rotated, in another organisation, or when made up', async () => {
    const w = await world('drain-dead');
    const other = await world('drain-dead-other');
    const ok = async (token: string, orgId = w.org.id) =>
      (await send(orgId, token, [mutation(w.a.id)])).statusCode;

    const live = (await w.grant(w.a.id))!;
    expect(await ok(live.token)).toBe(200);
    expect(await ok(live.token, other.org.id)).toBe(401);
    expect(await ok(`dg_${'A'.repeat(43)}`)).toBe(401);
    expect(await ok('dg_short')).toBe(401);

    // Rotation: the new token works, the old one is dead.
    const next = (await w.grant(w.a.id))!;
    expect(await ok(next.token)).toBe(200);
    expect(await ok(live.token)).toBe(401);

    // Revoked by the re-add path.
    await t.database.withTenantTx(w.ctx, (scope) =>
      t.modules.sync.api.drain.revoke(scope, { userId: w.exId }),
    );
    expect(await ok(next.token)).toBe(401);

    // Expired.
    const late = (await w.grant(w.a.id))!;
    await w.rows(
      sql`update sync.drain_grants set expires_at = now() - interval '1 minute' where revoked_at is null`,
    );
    expect(await ok(late.token)).toBe(401);
  });

  it('limits guesses per caller address without keeping a record per guess', async () => {
    const w = await world('drain-guess');
    const guess = () =>
      t.app.inject({
        method: 'POST',
        url: `/v1/orgs/${w.org.id}/sync/push`,
        remoteAddress: '10.9.9.9',
        headers: {
          host: API_HOST,
          authorization: `Bearer dg_${randomUUID().replaceAll('-', '').padEnd(43, 'A')}`,
        },
        payload: { mutations: [mutation(w.a.id)] },
      });
    const codes: number[] = [];
    for (let i = 0; i < 25; i += 1) codes.push((await guess()).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes.slice(21).every((c) => c === 429)).toBe(true);
    // A real grant from another address is unaffected.
    const g = (await w.grant(w.a.id))!;
    expect((await send(w.org.id, g.token, [mutation(w.a.id)])).statusCode).toBe(200);
  });

  it('stops minting after three rotations for a scope', async () => {
    const w = await world('drain-rotate');
    expect(await w.grant(w.a.id)).not.toBeNull();
    expect(await w.grant(w.a.id)).not.toBeNull();
    expect(await w.grant(w.a.id)).not.toBeNull();
    expect(await w.grant(w.a.id)).toBeNull();
    // Another scope has its own count.
    expect(await w.grant(w.b.id)).not.toBeNull();
  });
});
