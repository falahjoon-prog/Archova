import { sql } from 'drizzle-orm';
import { decodeId, uuidv7 } from '@archova/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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

async function setup() {
  const pm = await signUp(t.app, 'cnv-pm');
  const steel = await signUp(t.app, 'cnv-steel');
  const org = await createOrg(pm.browser, 'Chat Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower C', state: 'VIC' });
  const other = await createProject(pm.browser, org.id, { name: 'Tower D', state: 'VIC' });
  await addMember(pm.browser, org.id, project.id, steel.email, 'Subcontractor', 'Steelco');
  return { pm, steel, org, project, other, base: `/v1/orgs/${org.id}/projects/${project.id}` };
}

describe('project conversations', () => {
  it('starts a thread, replies, and lists the most recently active first with the latest message', async () => {
    const s = await setup();
    const a = await s.pm.browser.post(`${s.base}/conversations`, {
      subject: '  Pour programme ',
      body: 'Concrete sub is out this weekend.',
    });
    expect(a.statusCode).toBe(201);
    expect(a.json().subject).toBe('Pour programme');
    expect(a.json().messages).toHaveLength(1);
    expect(a.json().id).toMatch(/^cnv_/);

    const b = await s.pm.browser.post(`${s.base}/conversations`, {
      subject: 'Crane',
      body: 'Booked.',
    });
    expect(b.statusCode).toBe(201);

    // A reply moves the older thread back to the top.
    const reply = await s.pm.browser.post(`${s.base}/conversations/${a.json().id}/messages`, {
      body: 'Moved the pour to Monday.',
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().messages.map((m: { body: string }) => m.body)).toEqual([
      'Concrete sub is out this weekend.',
      'Moved the pour to Monday.',
    ]);

    const list = (await s.pm.browser.get(`${s.base}/conversations?limit=1`)).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].subject).toBe('Pour programme');
    expect(list.data[0].messageCount).toBe(2);
    expect(list.data[0].lastMessage.body).toBe('Moved the pour to Monday.');
    expect(list.data[0].lastMessage.authorName).toBeTruthy();
    expect(list.nextCursor).toBeTruthy();

    const next = (
      await s.pm.browser.get(`${s.base}/conversations?limit=1&cursor=${list.nextCursor}`)
    ).json();
    expect(next.data.map((x: { subject: string }) => x.subject)).toEqual(['Crane']);
    expect(next.nextCursor).toBeNull();

    const one = await s.pm.browser.get(`${s.base}/conversations/${a.json().id}`);
    expect(one.statusCode).toBe(200);
    expect(one.json().messages).toHaveLength(2);
  });

  it('rejects empty text and keeps threads on their own project', async () => {
    const s = await setup();
    expect(
      (await s.pm.browser.post(`${s.base}/conversations`, { subject: '  ', body: 'x' })).statusCode,
    ).toBe(422);
    const made = (
      await s.pm.browser.post(`${s.base}/conversations`, { subject: 'Hi', body: 'There' })
    ).json();
    const wrong = `/v1/orgs/${s.org.id}/projects/${s.other.id}`;
    expect((await s.pm.browser.get(`${wrong}/conversations/${made.id}`)).statusCode).toBe(404);
    expect((await s.pm.browser.get(`${wrong}/conversations`)).json().data).toEqual([]);
  });

  it('is closed to outside users and to people who are not on the project', async () => {
    const s = await setup();
    expect((await s.steel.browser.get(`${s.base}/conversations`)).statusCode).toBe(403);
    expect(
      (await s.steel.browser.post(`${s.base}/conversations`, { subject: 'Hi', body: 'There' }))
        .statusCode,
    ).toBe(403);
    const stranger = await signUp(t.app, 'cnv-stranger');
    expect([403, 404]).toContain(
      (await stranger.browser.get(`${s.base}/conversations`)).statusCode,
    );
  });

  it('notifies mentioned teammates, and only teammates on the project', async () => {
    const s = await setup();
    // A second teammate: an org member (builder staff), then added to the project.
    const mate = await signUp(t.app, 'cnv-mention');
    await t.adminDb.withTenantTx(
      {
        orgId: decodeId('org', s.org.id)!,
        userId: decodeId('user', s.pm.userId)!,
        principalType: 'member' as const,
        orgRole: 'owner' as const,
        entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
        requestId: 'test',
      },
      ({ tx }) =>
        tx.execute(sql`insert into platform.memberships (id, org_id, user_id, role, status, joined_at)
                       values (${uuidv7()}, ${decodeId('org', s.org.id)!}, ${decodeId('user', mate.userId)!}, 'member', 'active', now())`),
    );
    await addMember(
      s.pm.browser,
      s.org.id,
      s.project.id,
      mate.email,
      'Project Manager',
      'Chat Builder',
    );

    // A guest company member cannot be mentioned.
    const bad = await s.pm.browser.post(`${s.base}/conversations`, {
      subject: 'Hi',
      body: 'Hello @steel',
      mentions: [s.steel.userId],
    });
    expect(bad.statusCode).toBe(422);

    const ok = await s.pm.browser.post(`${s.base}/conversations`, {
      subject: 'Pour',
      body: 'Hello @mate, can you check the pour?',
      mentions: [mate.userId, s.pm.userId],
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().messages[0].mentionedUserIds).toEqual([mate.userId]);

    const inbox = (await mate.browser.get(`/v1/orgs/${s.org.id}/notifications`)).json();
    const n = inbox.data.find((x: { kind: string }) => x.kind === 'conversations.mention');
    expect(n.entityType).toBe('conversation');
    expect(n.entityId).toBe(ok.json().id);
    expect(n.title).toContain('mentioned you');
    // The author is never told about their own message.
    const own = (await s.pm.browser.get(`/v1/orgs/${s.org.id}/notifications`)).json();
    expect(own.data.some((x: { kind: string }) => x.kind === 'conversations.mention')).toBe(false);
  });
});
