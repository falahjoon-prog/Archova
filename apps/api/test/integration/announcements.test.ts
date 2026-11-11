import { sql } from 'drizzle-orm';
import { decodeId } from '@archova/domain';
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
  const pm = await signUp(t.app, 'ann-pm');
  const steel = await signUp(t.app, 'ann-steel');
  const tile = await signUp(t.app, 'ann-tile');
  const org = await createOrg(pm.browser, 'Notice Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower N', state: 'VIC' });
  const other = await createProject(pm.browser, org.id, { name: 'Tower M', state: 'VIC' });
  const steelCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    steel.email,
    'Subcontractor',
    'Steelco',
  );
  await addMember(pm.browser, org.id, project.id, tile.email, 'Subcontractor', 'Tileco');
  return {
    pm,
    steel,
    tile,
    org,
    project,
    other,
    steelCo,
    base: `/v1/orgs/${org.id}/projects/${project.id}`,
  };
}

type Inbox = { data: Array<{ kind: string; entityType: string; entityId: string; title: string }> };
const inbox = async (
  u: { browser: { get: (u: string) => Promise<{ json: () => unknown }> } },
  orgId: string,
) => (await u.browser.get(`/v1/orgs/${orgId}/notifications`)).json() as Inbox;

describe('project announcements', () => {
  it('posts to everyone, notifies each person, and tracks who has read it', async () => {
    const s = await setup();
    const posted = await s.pm.browser.post(`${s.base}/announcements`, {
      title: '  Pour   moved ',
      body: 'The Level 3 pour is now Monday.',
      priority: 'important',
      audience: { kind: 'all' },
    });
    expect(posted.statusCode, posted.body).toBe(201);
    const a = posted.json();
    expect(a.id).toMatch(/^ann_/);
    expect(a.title).toBe('Pour moved');
    expect(a.isMine).toBe(true);
    expect(a.receipts).toEqual({ recipientCount: 2, readCount: 0 });
    expect(a.recipients).toHaveLength(2);

    // Each recipient is told in their inbox, and sees it as unread.
    const n = (await inbox(s.steel, s.org.id)).data.find(
      (x: { kind: string }) => x.kind === 'announcements.posted',
    );
    expect(n?.entityType).toBe('announcement');
    expect(n?.entityId).toBe(a.id);
    expect(n?.title).toBe('Important: Pour moved');
    const mine = (await s.steel.browser.get(`${s.base}/announcements`)).json();
    expect(mine.unreadCount).toBe(1);
    expect(mine.data[0]).toMatchObject({ id: a.id, unread: true, isMine: false, receipts: null });

    // Opening it as a recipient hides the other recipients' read state.
    const read = await s.steel.browser.post(`${s.base}/announcements/${a.id}/read`, {});
    expect(read.statusCode).toBe(200);
    expect(read.json().unread).toBe(false);
    expect(read.json().readAt).toBeTruthy();
    expect(read.json().recipients).toBeNull();
    const again = (await s.steel.browser.post(`${s.base}/announcements/${a.id}/read`, {})).json();
    expect(again.readAt).toBe(read.json().readAt);
    expect((await s.steel.browser.get(`${s.base}/announcements`)).json().unreadCount).toBe(0);

    // The sender sees the receipts.
    const sender = (await s.pm.browser.get(`${s.base}/announcements/${a.id}`)).json();
    expect(sender.receipts).toEqual({ recipientCount: 2, readCount: 1 });
    expect(sender.recipients.filter((r: { readAt: string | null }) => r.readAt)).toHaveLength(1);
    expect(
      (await s.tile.browser.get(`${s.base}/announcements?unread=true`)).json().data,
    ).toHaveLength(1);
    expect(
      (await s.steel.browser.get(`${s.base}/announcements?unread=true`)).json().data,
    ).toHaveLength(0);
  });

  it('sends to a chosen group only, and refuses an empty audience', async () => {
    const s = await setup();
    const g = await s.pm.browser.post(`${s.base}/announcements`, {
      title: 'Steel crew',
      body: 'Crane booked for steelco.',
      audience: { kind: 'group', companyIds: [s.steelCo.companyId] },
    });
    expect(g.statusCode, g.body).toBe(201);
    expect(g.json().receipts.recipientCount).toBe(1);
    // The tiler was not in the group: it does not exist for them.
    expect((await s.tile.browser.get(`${s.base}/announcements`)).json().data).toEqual([]);
    expect((await s.tile.browser.get(`${s.base}/announcements/${g.json().id}`)).statusCode).toBe(
      404,
    );
    expect((await inbox(s.tile, s.org.id)).data).toEqual([]);

    const empty = await s.pm.browser.post(`${s.base}/announcements`, {
      title: 'Nobody',
      body: 'x',
      audience: { kind: 'group' },
    });
    expect(empty.statusCode).toBe(422);
    const blank = await s.pm.browser.post(`${s.base}/announcements`, {
      title: '  ',
      body: 'x',
      audience: { kind: 'all' },
    });
    expect(blank.statusCode).toBe(422);
    const strangerKey = await s.pm.browser.post(`${s.base}/announcements`, {
      title: 'Keys',
      body: 'x',
      audience: { kind: 'group', companyIds: [s.steelCo.companyId] },
      keyUserIds: [s.tile.userId],
    });
    expect(strangerKey.statusCode).toBe(422);
  });

  it('only people who can post may post, and announcements stay on their project', async () => {
    const s = await setup();
    const denied = await s.steel.browser.post(`${s.base}/announcements`, {
      title: 'Hi',
      body: 'There',
      audience: { kind: 'all' },
    });
    expect(denied.statusCode).toBe(403);
    const made = (
      await s.pm.browser.post(`${s.base}/announcements`, {
        title: 'Hi',
        body: 'There',
        audience: { kind: 'all' },
      })
    ).json();
    const wrong = `/v1/orgs/${s.org.id}/projects/${s.other.id}`;
    expect((await s.pm.browser.get(`${wrong}/announcements/${made.id}`)).statusCode).toBe(404);
    expect((await s.pm.browser.get(`${wrong}/announcements`)).json().data).toEqual([]);
    const stranger = await signUp(t.app, 'ann-stranger');
    expect([403, 404]).toContain(
      (await stranger.browser.get(`${s.base}/announcements`)).statusCode,
    );
  });

  it('Nova flags key people who have not read it after the window, and a confirmed nudge reminds them once', async () => {
    const s = await setup();
    const made = (
      await s.pm.browser.post(`${s.base}/announcements`, {
        title: 'Hoarding down',
        body: 'North hoarding comes down this week.',
        audience: { kind: 'all' },
        keyUserIds: [s.steel.userId],
        readByHours: 2,
      })
    ).json();
    expect(made.dueAt).toBeTruthy();
    expect(made.flags).toEqual([]);

    // Three hours later.
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
        tx.execute(
          sql`update announcements.announcements set created_at = now() - interval '3 hours' where id = ${decodeId('announcement', made.id)!}`,
        ),
    );
    const after = (await s.pm.browser.get(`${s.base}/announcements/${made.id}`)).json();
    expect(after.flags).toHaveLength(1);
    expect(after.flags[0]).toMatchObject({ userId: s.steel.userId, isKey: true, canNudge: true });
    expect(after.flags[0].hoursOverdue).toBeGreaterThanOrEqual(0);

    // The flagged person cannot see flags, and a recipient cannot nudge.
    expect((await s.steel.browser.get(`${s.base}/announcements/${made.id}`)).json().flags).toEqual(
      [],
    );
    expect(
      (
        await s.steel.browser.post(`${s.base}/announcements/${made.id}/nudges`, {
          userIds: [s.tile.userId],
        })
      ).statusCode,
    ).toBe(403);

    // Nothing was sent until the sender confirmed.
    expect(
      (await inbox(s.steel, s.org.id)).data.filter(
        (x: { kind: string }) => x.kind === 'announcements.nudge',
      ),
    ).toHaveLength(0);
    const nudge = await s.pm.browser.post(`${s.base}/announcements/${made.id}/nudges`, {
      userIds: [s.steel.userId],
    });
    expect(nudge.statusCode, nudge.body).toBe(200);
    expect(nudge.json()).toEqual({ nudged: 1, skipped: 0 });
    const repeat = await s.pm.browser.post(`${s.base}/announcements/${made.id}/nudges`, {
      userIds: [s.steel.userId],
    });
    expect(repeat.json()).toEqual({ nudged: 0, skipped: 1 });
    expect(
      (await inbox(s.steel, s.org.id)).data.filter(
        (x: { kind: string }) => x.kind === 'announcements.nudge',
      ),
    ).toHaveLength(1);
    const flagged = (await s.pm.browser.get(`${s.base}/announcements/${made.id}`)).json();
    expect(flagged.flags[0].canNudge).toBe(false);

    // Reading clears the flag.
    await s.steel.browser.post(`${s.base}/announcements/${made.id}/read`, {});
    expect((await s.pm.browser.get(`${s.base}/announcements/${made.id}`)).json().flags).toEqual([]);
    // Someone who is not a recipient cannot be reminded.
    const stray = await s.pm.browser.post(`${s.base}/announcements/${made.id}/nudges`, {
      userIds: [(await signUp(t.app, 'ann-stray')).userId],
    });
    expect(stray.statusCode).toBe(422);
  });

  it('Nova drafts from notes, keeps to what they say, and is closed to people who cannot post', async () => {
    const s = await setup();
    const draft = await s.pm.browser.post(`${s.base}/ai/announcement-drafts`, {
      notes: 'Slab pour moved from Thursday 12 Nov to Monday 16 Nov. Formwork crew stays on.',
      audience: 'all trades',
    });
    expect(draft.statusCode, draft.body).toBe(200);
    const d = draft.json();
    expect(d.title).toBeTruthy();
    expect(d.body).toContain('16 Nov');
    expect(d.runId).toMatch(/^air_/);
    expect(
      (await s.steel.browser.post(`${s.base}/ai/announcement-drafts`, { notes: 'x' })).statusCode,
    ).toBe(403);
  });
});
