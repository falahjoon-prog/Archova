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
