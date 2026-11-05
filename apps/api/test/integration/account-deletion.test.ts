import { decodeId } from '@archova/domain';
import { TEST_PASSWORD } from '@archova/testing';
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

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const deleteMe = (b: Browser, body: unknown = { confirm: 'DELETE' }) =>
  b.request('DELETE', '/v1/me', body);

describe('deleting your own account (DELETE /v1/me)', () => {
  it('needs the confirmation word', async () => {
    const u = await signUp(t.app, 'del-confirm');
    expect((await deleteMe(u.browser, { confirm: 'yes' })).statusCode).toBe(422);
    expect((await deleteMe(u.browser, {})).statusCode).toBe(422);
    expect((await u.browser.get('/v1/me')).statusCode).toBe(200);
  });

  it('erases a person who owns nothing, ends their session and frees the email', async () => {
    const u = await signUp(t.app, 'del-plain');
    const res = await deleteMe(u.browser);
    expect(res.statusCode).toBe(204);
    expect((await u.browser.get('/v1/me')).statusCode).toBe(401);

    const login = await new Browser(t.app).post('/v1/auth/login', {
      email: u.email,
      password: TEST_PASSWORD,
    });
    expect(login.statusCode).toBe(401);

    // The row stays for the records others keep, but holds nothing about the person.
    const [row] = (
      await t.adminDb.withGlobalTx('identity', (tx) =>
        tx.execute<{ name: string; email: string; status: string; phone: string | null }>(
          sql`select name, email, status, phone from identity.users
              where id = ${decodeId('user', u.userId)!}`,
        ),
      )
    ).rows;
    expect(row).toMatchObject({ name: 'Deleted user', status: 'deleted', phone: null });
    expect(row!.email).toMatch(/^deleted\+.*@deleted\.invalid$/);

    const again = await new Browser(t.app).post('/v1/auth/signup', {
      email: u.email,
      password: 'another long passphrase 99',
      name: 'Back again',
    });
    expect(again.statusCode).toBe(201);
  });

  it('refuses a sole owner while other people use the organisation', async () => {
    const owner = await signUp(t.app, 'del-owner');
    const other = await signUp(t.app, 'del-other');
    const org = await createOrg(owner.browser, 'Sole Builders');
    const project = await createProject(owner.browser, org.id, { name: 'Tower D', state: 'NSW' });
    await addMember(owner.browser, org.id, project.id, other.email, 'Site Manager');

    const res = await deleteMe(owner.browser);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'account.sole_owner',
      orgs: [{ id: org.id, name: 'Sole Builders' }],
    });
    expect((await owner.browser.get('/v1/me')).statusCode).toBe(200);
  });

  it('closes an organisation the owner is alone in, with the account', async () => {
    const owner = await signUp(t.app, 'del-solo');
    const org = await createOrg(owner.browser, 'Solo Builders');
    expect((await deleteMe(owner.browser)).statusCode).toBe(204);
    const orgId = decodeId('org', org.id)!;
    const [closed] = (
      await t.adminDb.withTenantTx(
        {
          orgId,
          userId: decodeId('user', owner.userId)!,
          principalType: 'member',
          orgRole: 'owner',
          entitlements: { plan: 'x', state: 'active', modules: [], limits: {} },
          requestId: 't',
        },
        ({ tx }) =>
          tx.execute<{ deleted: boolean }>(
            sql`select deleted_at is not null as deleted from platform.orgs where id = ${orgId}`,
          ),
      )
    ).rows;
    expect(closed?.deleted).toBe(true);
  });

  it('removes a member from every project and leaves the owner’s organisation working', async () => {
    const owner = await signUp(t.app, 'del-keep');
    const member = await signUp(t.app, 'del-member');
    const org = await createOrg(owner.browser, 'Keep Builders');
    const project = await createProject(owner.browser, org.id, { name: 'Tower K', state: 'QLD' });
    await addMember(owner.browser, org.id, project.id, member.email, 'Site Manager');
    const members = () =>
      owner.browser
        .get(`/v1/orgs/${org.id}/projects/${project.id}/members`)
        .then((r) => r.json().data as Array<{ email: string }>);
    expect((await members()).some((m) => m.email === member.email)).toBe(true);

    expect((await deleteMe(member.browser)).statusCode).toBe(204);
    expect((await members()).some((m) => m.email === member.email)).toBe(false);
    expect((await owner.browser.get(`/v1/orgs/${org.id}/projects`)).statusCode).toBe(200);
  });
});
