import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId, uuidv7 } from '@archova/domain';
import { createNotifications } from '@archova/mod-notifications';
import { createOrg, createTestContext, signUp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Inbox = {
  data: Array<{ id: string; title: string; readAt: string | null; entityId: string }>;
  unreadCount: number;
};

describe('notification inbox', () => {
  it('shows a person only their own notifications, newest first, and marks them read', async () => {
    const ana = await signUp(t.app, 'ntf-ana');
    const ben = await signUp(t.app, 'ntf-ben');
    const org = await createOrg(ana.browser, 'Inbox Builders');
    const orgUuid = decodeId('org', org.id)!;
    const anaId = decodeId('user', (await ana.browser.get('/v1/me')).json().user.id)!;
    const benId = decodeId('user', (await ben.browser.get('/v1/me')).json().user.id)!;
    const meetingId = uuidv7();
    const make = (userId: string, n: number) => ({
      userId,
      projectId: null,
      kind: 'meeting.action_due_soon',
      entityType: 'meeting' as const,
      entityId: meetingId,
      title: `Action 1.${n} is due today`,
      dedupeKey: `k${n}`,
    });
    await t.database.withTenantTx(
      {
        orgId: orgUuid,
        userId: anaId,
        principalType: 'member',
        orgRole: null,
        entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
        requestId: 'seed',
      },
      async (scope) => {
        expect(
          await createNotifications(scope, [make(anaId, 1), make(anaId, 2), make(benId, 3)]),
        ).toBe(3);
        // The same key again is a no-op.
        expect(await createNotifications(scope, [make(anaId, 1)])).toBe(0);
      },
    );

    const base = `/v1/orgs/${org.id}/notifications`;
    const list: Inbox = (await ana.browser.get(base)).json();
    expect(list.data.map((n) => n.title).sort()).toEqual([
      'Action 1.1 is due today',
      'Action 1.2 is due today',
    ]);
    expect(list.unreadCount).toBe(2);
    expect(list.data[0]!.entityId).toMatch(/^mtg_/);

    // Ben's id is not found for Ana; she cannot read it, and her own mark is idempotent.
    const benList: Inbox = (await ben.browser.get(base)).json();
    // Ben is not a member of Ana's org, so he has no inbox here at all.
    expect(benList.data ?? []).toEqual([]);
    const first = list.data[0]!.id;
    const read = await ana.browser.post(`${base}/${first}/read`, {});
    expect(read.statusCode).toBe(200);
    expect(read.json().readAt).not.toBeNull();
    const again = await ana.browser.post(`${base}/${first}/read`, {});
    expect(again.json().readAt).toBe(read.json().readAt);
    expect(((await ana.browser.get(`${base}?unreadOnly=true`)).json() as Inbox).data).toHaveLength(
      1,
    );
    expect(
      (await ana.browser.post(`${base}/ntf_00000000000000000000000000/read`, {})).statusCode,
    ).toBe(404);

    expect((await ana.browser.post(`${base}/read-all`, {})).statusCode).toBe(204);
    expect(((await ana.browser.get(base)).json() as Inbox).unreadCount).toBe(0);
  });
});
