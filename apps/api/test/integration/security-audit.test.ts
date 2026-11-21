import { decodeId } from '@archova/domain';
import { anchorChain, verifyChain } from '@archova/mod-audit';
import { TEST_PASSWORD } from '@archova/testing';
import { PLATFORM_AUDIT_SHARDS, type TenantContext } from '@archova/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Browser,
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

// The security audit log (security-licensing/07 §3-4, §9): append-only, hash-chained, tenant-scoped, verifiable.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Event = {
  id: string;
  seq: number;
  action: string;
  actorId: string | null;
  targetId: string | null;
};
type Page = { data: Event[]; nextCursor: string | null };

const ctxFor = (orgId: string, userId: string): TenantContext => ({
  orgId,
  userId,
  principalType: 'member',
  orgRole: 'owner',
  entitlements: { plan: '', state: 'active', modules: [], limits: {} },
  requestId: 'security-audit-test',
});

async function setup(label: string) {
  const owner = await signUp(t.app, label);
  const org = await createOrg(owner.browser, 'Audit Builders');
  const base = `/v1/orgs/${org.id}`;
  return {
    owner,
    org,
    base,
    orgUuid: decodeId('org', org.id)!,
    ctx: ctxFor(decodeId('org', org.id)!, decodeId('user', owner.userId)!),
  };
}

describe('Security audit log', () => {
  it('records token and access events in order, and alerts on a write token', async () => {
    const s = await setup('sal-a');
    const project = await createProject(s.owner.browser, s.org.id, {
      name: 'Tower S',
      state: 'NSW',
    });
    const sub = await signUp(t.app, 'sal-sub');
    await addMember(s.owner.browser, s.org.id, project.id, sub.email, 'Subcontractor', 'Sparky');
    const created = await s.owner.browser.post(`${s.base}/api-tokens`, {
      name: 'Warehouse',
      scopes: ['projects:write'],
    });
    expect(created.statusCode).toBe(201);
    const tokenId = created.json().id as string;
    expect((await s.owner.browser.del(`${s.base}/api-tokens/${tokenId}`)).statusCode).toBe(204);

    const list = (await s.owner.browser.get(`${s.base}/security-audit-events`)).json() as Page;
    const actions = list.data.map((e) => e.action);
    expect(actions).toContain('project_member.added');
    expect(actions).toContain('api_token.created');
    expect(actions).toContain('api_token.revoked');
    // Newest first, and the chain is gap free.
    const seqs = list.data.map((e) => e.seq);
    expect([...seqs].sort((a, b) => b - a)).toEqual(seqs);
    expect(seqs[0]! - seqs[seqs.length - 1]! + 1).toBe(seqs.length);
    // The secret never reaches the log.
    expect(JSON.stringify(list)).not.toContain('pk_live_');

    const alerts = (await s.owner.browser.get(`${s.base}/security-audit-alerts`)).json() as {
      data: Array<{ rule: string }>;
    };
    expect(alerts.data.map((a) => a.rule)).toContain('api_token.write_scope');

    const filtered = (
      await s.owner.browser.get(`${s.base}/security-audit-events?action=api_token`)
    ).json() as Page;
    expect(filtered.data.length).toBe(2);
  });

  it('is for owners and admins only, and one company never sees another', async () => {
    const a = await setup('sal-iso-a');
    const b = await setup('sal-iso-b');
    const project = await createProject(a.owner.browser, a.org.id, { name: 'P', state: 'VIC' });
    const sub = await signUp(t.app, 'sal-iso-sub');
    await addMember(a.owner.browser, a.org.id, project.id, sub.email, 'Subcontractor', 'Sparky');
    expect((await sub.browser.get(`${a.base}/security-audit-events`)).statusCode).toBe(403);
    expect(
      (await b.owner.browser.get(`${a.base}/security-audit-events`)).statusCode,
    ).toBeGreaterThanOrEqual(403);
    const mine = (await b.owner.browser.get(`${b.base}/security-audit-events`)).json() as Page;
    expect(mine.data.some((e) => e.action === 'project_member.added')).toBe(false);
  });

  it('refuses edits and deletes from the application role', async () => {
    const s = await setup('sal-ro');
    await s.owner.browser.post(`${s.base}/api-tokens`, { name: 'x', scopes: ['projects:read'] });
    const asApp = (query: string) =>
      t.database.withTenantTx(s.ctx, (scope) => scope.tx.execute(sql.raw(query)));
    await expect(asApp(`update audit.security_events set ip = 'x'`)).rejects.toThrow();
    await expect(asApp(`delete from audit.security_events`)).rejects.toThrow();
    await expect(
      asApp(
        `insert into audit.security_events (id, org_id, seq, occurred_at, actor_type, action, prev_hash, hash)
         values (gen_random_uuid(), '${s.orgUuid}', 99, now(), 'user', 'a.b', '\\x00', '\\x00')`,
      ),
    ).rejects.toThrow();
    const rows = await t.database.withTenantTx(s.ctx, (scope) =>
      scope.tx.execute(
        sql`select count(*)::int as n from audit.security_events where ip = 'x' or seq = 99`,
      ),
    );
    expect(rows.rows[0]).toEqual({ n: 0 });
  });

  it('verifies a clean chain, anchors it, and catches an edit made behind the triggers', async () => {
    const s = await setup('sal-chain');
    await s.owner.browser.post(`${s.base}/api-tokens`, { name: 'one', scopes: ['projects:read'] });
    await s.owner.browser.post(`${s.base}/api-tokens`, { name: 'two', scopes: ['projects:read'] });

    const clean = await t.database.withTenantTx(s.ctx, (scope) => verifyChain(scope));
    expect(clean.ok).toBe(true);
    expect(clean.checked).toBeGreaterThanOrEqual(2);

    const puts: string[] = [];
    const store = {
      putIfAbsent: async (key: string, _b: Uint8Array, p: { sha256Base64: string }) => {
        puts.push(key);
        return { created: true, sha256Base64: p.sha256Base64 };
      },
    };
    const first = await t.database.withTenantTx(s.ctx, (scope) =>
      anchorChain(scope, store, new Date()),
    );
    expect(first.anchored).toBe(true);
    const again = await t.database.withTenantTx(s.ctx, (scope) =>
      anchorChain(scope, store, new Date()),
    );
    expect(again.anchored).toBe(false);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toContain(`security-audit-anchors/${s.orgUuid}/`);

    const integrity = (await s.owner.browser.get(`${s.base}/security-audit-integrity`)).json();
    expect(integrity.lastAnchor).toMatchObject({ writeOnce: true });

    // Someone with owner rights on the table switches the trigger off and edits an old event.
    const admin = await t.adminDb.pool.connect();
    try {
      await admin.query('alter table audit.security_events disable trigger append_only');
      await admin.query(
        `update audit.security_events set ip = '203.0.113.9' where org_id = $1 and seq = 1`,
        [s.orgUuid],
      );
      await admin.query('alter table audit.security_events enable trigger append_only');
    } finally {
      admin.release();
    }
    const broken = await t.database.withTenantTx(s.ctx, (scope) => verifyChain(scope));
    expect(broken.ok).toBe(false);
    expect(broken.firstBadSeq).toBe(1);
    const alerts = (await s.owner.browser.get(`${s.base}/security-audit-alerts`)).json() as {
      data: Array<{ rule: string }>;
    };
    expect(alerts.data.map((a) => a.rule)).toContain('audit.chain_broken');
  });

  it('records failed and successful sign-ins in the platform chain, and alerts on ten failures', async () => {
    const { email, userId: publicId } = await signUp(t.app, 'sal-login');
    const userId = decodeId('user', publicId)!;
    for (let i = 0; i < 10; i++) {
      const r = await new Browser(t.app).post('/v1/auth/login', {
        email,
        password: 'wrong-password-1',
      });
      expect(r.statusCode).toBe(401);
    }
    const okLogin = await new Browser(t.app).post('/v1/auth/login', {
      email,
      password: TEST_PASSWORD,
    });
    expect(okLogin.statusCode).toBe(200);
    const nil = '00000000-0000-0000-0000-0000000000%';
    const failed = await t.adminDb.pool.query(
      `select count(*)::int as n, bool_and(target_id <> $2) as hashed from audit.security_events
        where org_id::text like $1 and action = 'auth.login.failed' and actor_id = $3`,
      [nil, email, userId],
    );
    expect(failed.rows[0]).toEqual({ n: 10, hashed: true });
    const ok = await t.adminDb.pool.query(
      `select count(*)::int as n from audit.security_events
        where org_id::text like $1 and action = 'auth.login.succeeded' and actor_id = $2`,
      [nil, userId],
    );
    expect(ok.rows[0].n).toBe(1);
    const alert = await t.adminDb.pool.query(
      `select count(*)::int as n from audit.alerts where org_id::text like $1 and rule = 'auth.repeated_failures'`,
      [nil],
    );
    expect(alert.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('binds every write to the transaction org, and keeps writes off the application role', async () => {
    const a = await setup('sal-bind-a');
    const b = await setup('sal-bind-b');
    const call = (ctx: TenantContext, org: string | null) =>
      t.database.withTenantTx(ctx, (scope) =>
        scope.tx.execute(
          sql`select audit.append_event(${org}::uuid, 'user', null, 'test.event.happened')`,
        ),
      );
    await expect(call(a.ctx, b.orgUuid)).rejects.toThrow();
    await expect(call(a.ctx, null)).rejects.toThrow();
    await expect(call(a.ctx, a.orgUuid)).resolves.toBeDefined();
    // Only the definer functions write anchors and runs.
    await expect(
      t.database.withTenantTx(a.ctx, (scope) =>
        scope.tx.execute(
          sql`insert into audit.chain_anchors (id, org_id, seq, hash) values (gen_random_uuid(), ${a.orgUuid}, 1, '\\x00')`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      t.database.withTenantTx(a.ctx, (scope) =>
        scope.tx.execute(
          sql`insert into audit.verification_runs (id, org_id, checked, ok) values (gen_random_uuid(), ${a.orgUuid}, 1, true)`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('stores at most 20 failed sign-ins per account and address in a window, and verifies the platform shards', async () => {
    const { email } = await signUp(t.app, 'sal-flood');
    const attacker = new Browser(t.app);
    for (let i = 0; i < 25; i++)
      await attacker.post('/v1/auth/login', { email, password: 'wrong-password-1' });
    const stored = await t.adminDb.pool.query(
      `select target_id, count(*)::int as n from audit.security_events
        where action = 'auth.login.failed' and org_id::text like '00000000-0000-0000-0000-0000000000%'
        group by target_id order by n desc limit 1`,
    );
    expect(stored.rows[0].n).toBeLessThanOrEqual(20);
    for (const shard of PLATFORM_AUDIT_SHARDS) {
      const r = await t.database.withTenantTx(ctxFor(shard, shard), (scope) => verifyChain(scope));
      expect(r.ok).toBe(true);
    }
  });

  it('shrinks oversized details instead of storing them', async () => {
    const s = await setup('sal-size');
    await t.database.withTenantTx(s.ctx, (scope) =>
      scope.tx.execute(
        sql`select audit.append_event(${s.orgUuid}::uuid, 'user', null, 'test.big.event', null, null, null, null, null, null, '{}'::jsonb, jsonb_build_object('x', repeat('a', 20000)))`,
      ),
    );
    const r = await t.adminDb.pool.query(
      `select metadata from audit.security_events where org_id = $1 and action = 'test.big.event'`,
      [s.orgUuid],
    );
    expect(r.rows[0].metadata).toEqual({ truncated: true });
  });
});
