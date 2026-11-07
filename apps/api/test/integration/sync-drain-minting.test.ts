import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId, uuidv7 } from '@archova/domain';
import {
  API_HOST,
  addMember,
  createOrg,
  createProject,
  createTestContext,
  removeMember,
  signUp,
  type Browser,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

/** A builder, one project, and a worker who is a member of the organisation and on the project. */
async function world(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Tower A', state: 'NSW' });
  const ctx = {
    orgId: decodeId('org', org.id)!,
    userId: decodeId('user', pm.userId)!,
    principalType: 'member' as const,
    orgRole: 'owner' as const,
    entitlements: { plan: 'x', state: 'active' as const, modules: [] as string[], limits: {} },
    requestId: 'test',
  };
  const worker = async (name: string) => {
    const w = await signUp(t.app, `${label}-${name}`);
    await t.adminDb.withTenantTx(ctx, ({ tx }) =>
      tx.execute(sql`insert into platform.memberships (id, org_id, user_id, role, status, joined_at)
                     values (${uuidv7()}, ${ctx.orgId}, ${decodeId('user', w.userId)!}, 'member', 'active', now())`),
    );
    await addMember(pm.browser, org.id, project.id, w.email, 'Subcontractor', `${name} Pty`);
    return w;
  };
  const pull = async (who: { browser: Browser }) =>
    (
      await who.browser.get(
        `/v1/orgs/${org.id}/sync/pull?scopes=${encodeURIComponent(`project:${project.id}:defects`)}&since=0`,
      )
    ).json() as {
      revokedScopes: Array<{
        projectId: string;
        module: string | null;
        drainGrant?: { token: string; expiresAt: string; projectId: string | null };
      }>;
    };
  const late = (token: string) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/orgs/${org.id}/sync/push`,
      headers: { host: API_HOST, authorization: `Bearer ${token}` },
      payload: {
        mutations: [
          {
            mutationId: randomUUID(),
            command: 'defects.transition',
            entityId: 'dfx_00000000000000000000000000',
            projectId: project.id,
            baseVersion: 3,
            clientAt: new Date().toISOString(),
            payload: { action: 'markReadyForReview' },
          },
        ],
      },
    });
  return { pm, org, project, ctx, worker, pull, late };
}

describe('drain grant (X38), handed out on the pull', () => {
  it('gives the grant to someone removed in the ordinary way, and it queues their work', async () => {
    const w = await world('mint-ord');
    const sam = await w.worker('sam');
    expect((await w.pull(sam)).revokedScopes).toEqual([]);

    await removeMember(w.pm.browser, w.org.id, w.project.id, sam.email, 'ordinary');
    const { revokedScopes } = await w.pull(sam);
    expect(revokedScopes).toHaveLength(1);
    expect(revokedScopes[0]).toMatchObject({ projectId: w.project.id, module: null });
    const grant = revokedScopes[0]!.drainGrant!;
    expect(grant.token).toMatch(/^dg_/);
    expect(grant.projectId).toBe(w.project.id);
    const sent = await w.late(grant.token);
    expect(sent.json().results[0].status).toBe('pending_review');
  });

  it('is never cached, and a grant stops working if the removal is escalated', async () => {
    const w = await world('mint-escalate');
    const sam = await w.worker('sam');
    await removeMember(w.pm.browser, w.org.id, w.project.id, sam.email, 'ordinary');
    const res = await sam.browser.get(
      `/v1/orgs/${w.org.id}/sync/pull?scopes=${encodeURIComponent(`project:${w.project.id}:defects`)}&since=0`,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    const grant = res.json().revokedScopes[0].drainGrant;
    expect((await w.late(grant.token)).statusCode).toBe(200);
    // An admin decides it was for cause after all: the phone's grant is dead at once.
    await t.adminDb.withTenantTx(w.ctx, ({ tx }) =>
      tx.execute(sql`update platform.project_members set removal_kind = 'for_cause'
                     where user_id = ${decodeId('user', sam.userId)!}`),
    );
    expect((await w.late(grant.token)).statusCode).toBe(401);
  });

  it('gives nothing to someone removed for cause or told to wipe now', async () => {
    const w = await world('mint-none');
    const cause = await w.worker('cause');
    const wipe = await w.worker('wipe');
    await removeMember(w.pm.browser, w.org.id, w.project.id, cause.email, 'for_cause');
    await removeMember(w.pm.browser, w.org.id, w.project.id, wipe.email, 'wipe_now');
    for (const who of [cause, wipe]) {
      const { revokedScopes } = await w.pull(who);
      expect(revokedScopes).toEqual([
        expect.objectContaining({ projectId: w.project.id, module: null }),
      ]);
      expect(revokedScopes[0]).not.toHaveProperty('drainGrant');
    }
  });

  it('gives nothing once the 72 hours are over', async () => {
    const w = await world('mint-late');
    const sam = await w.worker('sam');
    await removeMember(w.pm.browser, w.org.id, w.project.id, sam.email, 'ordinary');
    await t.adminDb.withTenantTx(w.ctx, ({ tx }) =>
      tx.execute(sql`update platform.project_members set removed_at = now() - interval '80 hours'
                     where user_id = ${decodeId('user', sam.userId)!}`),
    );
    const { revokedScopes } = await w.pull(sam);
    expect(revokedScopes[0]).not.toHaveProperty('drainGrant');
  });

  it('counts rotations within one stretch of access; being added back ends the old grant', async () => {
    const w = await world('mint-rot');
    const sam = await w.worker('sam');
    await removeMember(w.pm.browser, w.org.id, w.project.id, sam.email, 'ordinary');
    const tokens: string[] = [];
    for (let i = 0; i < 4; i++) {
      const g = (await w.pull(sam)).revokedScopes[0]!.drainGrant;
      if (g) tokens.push(g.token);
    }
    // Three grants for the scope, then an admin has to step in. Only the last one still works.
    expect(tokens).toHaveLength(3);
    expect((await w.late(tokens[0]!)).statusCode).toBe(401);
    expect((await w.late(tokens[2]!)).statusCode).toBe(200);

    // Added back: the old grant is dead, and the person reads the project normally again.
    await addMember(w.pm.browser, w.org.id, w.project.id, sam.email, 'Subcontractor', 'Sam Again');
    expect((await w.late(tokens[2]!)).statusCode).toBe(401);
    expect((await w.pull(sam)).revokedScopes).toEqual([]);

    // Removed a second time: a new stretch, so grants are available again.
    await removeMember(w.pm.browser, w.org.id, w.project.id, sam.email, 'ordinary');
    const again = (await w.pull(sam)).revokedScopes[0]!.drainGrant!;
    expect((await w.late(again.token)).statusCode).toBe(200);
    expect((await w.late(tokens[2]!)).statusCode).toBe(401);
  });
});

describe('drain grant (X38), on the 401 for someone with no access left', () => {
  /** An external collaborator: on the one project, not a member of the organisation. */
  async function external(w: Awaited<ReturnType<typeof world>>, name: string) {
    const x = await signUp(t.app, `${w.org.id.slice(-6)}-${name}`);
    await addMember(w.pm.browser, w.org.id, w.project.id, x.email, 'Consultant', `${name} Pty`);
    return x;
  }

  it('says access.revoked with a grant after an ordinary removal, on the sync calls only', async () => {
    const w = await world('ext-ord');
    const ann = await external(w, 'ann');
    expect((await w.pull(ann)).revokedScopes).toEqual([]);
    await removeMember(w.pm.browser, w.org.id, w.project.id, ann.email, 'ordinary');

    const res = await ann.browser.get(
      `/v1/orgs/${w.org.id}/sync/pull?scopes=${encodeURIComponent(`project:${w.project.id}:defects`)}&since=0`,
    );
    expect(res.statusCode).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toMatchObject({ code: 'access.revoked' });
    const grant = res.json().drainGrant;
    expect(grant).toMatchObject({ projectId: w.project.id, module: null });
    expect((await w.late(grant.token)).json().results[0].status).toBe('pending_review');

    // The rest of the API still does not confirm the organisation exists.
    expect((await ann.browser.get(`/v1/orgs/${w.org.id}/projects`)).statusCode).toBe(404);
  });

  it('keeps answering 404 for removal for cause, wipe, or after the 72 hours', async () => {
    const w = await world('ext-none');
    const cause = await external(w, 'cause');
    const late = await external(w, 'late');
    await removeMember(w.pm.browser, w.org.id, w.project.id, cause.email, 'for_cause');
    await removeMember(w.pm.browser, w.org.id, w.project.id, late.email, 'ordinary');
    await t.adminDb.withTenantTx(w.ctx, ({ tx }) =>
      tx.execute(sql`update platform.project_members set removed_at = now() - interval '80 hours'
                     where user_id = ${decodeId('user', late.userId)!}`),
    );
    for (const who of [cause, late]) {
      const res = await who.browser.get(
        `/v1/orgs/${w.org.id}/sync/pull?scopes=${encodeURIComponent(`project:${w.project.id}:defects`)}&since=0`,
      );
      expect(res.statusCode).toBe(404);
    }
  });

  it('stops a live grant when the person is later put on an organisation hold', async () => {
    const w = await world('mint-held');
    const sam = await w.worker('sam');
    await removeMember(w.pm.browser, w.org.id, w.project.id, sam.email, 'ordinary');
    const res = await sam.browser.get(
      `/v1/orgs/${w.org.id}/sync/pull?scopes=${encodeURIComponent(`project:${w.project.id}:defects`)}&since=0`,
    );
    const grant = res.json().revokedScopes[0].drainGrant;
    expect((await w.late(grant.token)).statusCode).toBe(200);
    await t.adminDb.withTenantTx(w.ctx, ({ tx }) =>
      tx.execute(sql`insert into platform.memberships (id, org_id, user_id, role, status)
                     values (${uuidv7()}, ${w.ctx.orgId}, ${decodeId('user', sam.userId)!}, 'member', 'suspended')
                     on conflict (org_id, user_id) do update set status = 'suspended'`),
    );
    expect((await w.late(grant.token)).statusCode).toBe(401);
  });

  it('gives nothing when another removal in the window was for cause, or the person is held', async () => {
    const w = await world('ext-mixed');
    const second = (await createProject(w.pm.browser, w.org.id, { name: 'Tower B', state: 'NSW' }))
      .id;
    const mixed = await external(w, 'mixed');
    await addMember(w.pm.browser, w.org.id, second, mixed.email, 'Consultant', 'Mixed Pty');
    await removeMember(w.pm.browser, w.org.id, second, mixed.email, 'for_cause');
    await removeMember(w.pm.browser, w.org.id, w.project.id, mixed.email, 'ordinary');
    const url = `/v1/orgs/${w.org.id}/sync/pull?scopes=${encodeURIComponent(`project:${w.project.id}:defects`)}&since=0`;
    expect((await mixed.browser.get(url)).statusCode).toBe(404);

    const held = await external(w, 'held');
    await removeMember(w.pm.browser, w.org.id, w.project.id, held.email, 'ordinary');
    await t.adminDb.withTenantTx(w.ctx, ({ tx }) =>
      tx.execute(sql`insert into platform.memberships (id, org_id, user_id, role, status)
                     values (${uuidv7()}, ${w.ctx.orgId}, ${decodeId('user', held.userId)!}, 'member', 'suspended')`),
    );
    expect((await held.browser.get(url)).statusCode).toBe(404);
  });
});
