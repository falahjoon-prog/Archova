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

const HOUR = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sm = await signUp(t.app, `${label}-sm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const org = await createOrg(pm.browser, `${label} Builder`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sm.email, 'Site Manager', `${label} Builder`);
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Formco');
  return { pm, sm, sub, base };
}

describe('Material delivery scheduling', () => {
  it('books deliveries, flags clashes, checks trucks in and drafts a supplier note', async () => {
    const s = await setup('logi');
    const res = (body: object) => s.sm.browser.post(`${s.base}/logistics/resources`, body);

    // Subcontractors can look but not keep the list of docks.
    expect(
      (await s.sub.browser.post(`${s.base}/logistics/resources`, { name: 'x', kind: 'dock' }))
        .statusCode,
    ).toBe(403);
    const dock0 = await res({ name: 'Gate 2 dock', kind: 'dock' });
    const dock = dock0.json();
    const crane = (await res({ name: 'Tower crane', kind: 'crane' })).json();
    expect((await res({ name: 'Gate 2 dock', kind: 'dock' })).statusCode).toBe(409);
    expect((await s.sub.browser.get(`${s.base}/logistics/resources`)).json().data).toHaveLength(2);

    const book = (over: object) =>
      s.sm.browser.post(`${s.base}/deliveries`, {
        title: 'Level 3 beams',
        supplierName: 'Acme Steel',
        supplierEmail: 'dispatch@acme.test',
        windowStart: inHours(1),
        windowEnd: inHours(2),
        zoneId: dock.id,
        ...over,
      });
    const a = await book({ liftResourceId: crane.id });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({
      number: 1,
      status: 'scheduled',
      needsLift: true,
      liftResourceId: crane.id,
    });

    // An overlapping delivery is allowed but flagged on both the dock and the crane.
    const b = await book({
      title: 'Reo',
      windowStart: inHours(1.5),
      windowEnd: inHours(2.5),
      liftResourceId: crane.id,
    });
    expect(b.json().number).toBe(2);
    const insights = (await s.sub.browser.get(`${s.base}/delivery-insights`)).json();
    const kinds = insights.flags.map((f: { kind: string }) => f.kind).sort();
    expect(kinds).toEqual(['double_booked', 'double_booked', 'lift_clash', 'lift_clash']);
    expect(insights.counts.clashes).toBe(2);

    // Nova finds a window that avoids both.
    const slots = (
      await s.sub.browser.post(`${s.base}/delivery-slot-suggestions`, {
        durationMinutes: 60,
        needsLift: true,
        days: 3,
      })
    ).json().data;
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]).toMatchObject({ zoneId: dock.id, liftResourceId: crane.id });

    // Window must end after it starts; a zone must be a dock; a made-up PO is refused.
    expect((await book({ windowEnd: inHours(0.5) })).statusCode).toBe(422);
    expect((await book({ zoneId: crane.id })).statusCode).toBe(422);
    expect((await book({ commitmentId: 'cmt_00000000000000000000000000' })).statusCode).toBe(422);

    // Gate check-in: any site member logs arrival, then unloading; out-of-order moves are refused.
    const id = a.json().id as string;
    const ci = (event: string) =>
      s.sub.browser.post(`${s.base}/deliveries/${id}/check-in`, { event });
    expect((await ci('unloaded')).statusCode).toBe(409);
    expect((await ci('arrived')).json()).toMatchObject({ status: 'arrived' });
    expect((await ci('unloaded')).json().status).toBe('unloaded');
    expect((await ci('arrived')).statusCode).toBe(409);
    expect(
      (
        await s.sub.browser.post(`${s.base}/deliveries/${id}/check-in`, {
          event: 'arrived',
          at: inHours(3),
        })
      ).statusCode,
    ).toBe(422);

    // Moving a delivery is the coordinator's call; the supplier note proposes a free slot.
    const bid = b.json().id as string;
    expect(
      (await s.sub.browser.post(`${s.base}/deliveries/${bid}/changes`, { action: 'miss' }))
        .statusCode,
    ).toBe(403);
    const notice = (
      await s.sm.browser.post(`${s.base}/deliveries/${bid}/notice`, {
        kind: 'reschedule',
        reason: 'Crane is booked',
      })
    ).json();
    expect(notice.to).toBe('dispatch@acme.test');
    expect(notice.body).toContain('Crane is booked');
    expect(notice.proposed).toMatchObject({ zoneId: dock.id, liftResourceId: crane.id });
    const moved = await s.sm.browser.post(`${s.base}/deliveries/${bid}/changes`, {
      action: 'reschedule',
      windowStart: notice.proposed.start,
      windowEnd: notice.proposed.end,
    });
    expect(moved.json()).toMatchObject({ status: 'scheduled', windowStart: notice.proposed.start });
    expect((await s.sm.browser.get(`${s.base}/delivery-insights`)).json().counts.clashes).toBe(0);

    // Delay and cancel need a reason; history records each step.
    expect(
      (await s.sm.browser.post(`${s.base}/deliveries/${bid}/changes`, { action: 'cancel' }))
        .statusCode,
    ).toBe(422);
    const cancelled = await s.sm.browser.post(`${s.base}/deliveries/${bid}/changes`, {
      action: 'cancel',
      reason: 'Design change',
    });
    expect(cancelled.json().status).toBe('cancelled');
    const detail = (await s.sub.browser.get(`${s.base}/deliveries/${bid}`)).json();
    expect(detail.events.map((e: { kind: string }) => e.kind)).toEqual([
      'created',
      'notice_drafted',
      'rescheduled',
      'cancelled',
    ]);

    // Filtering by status and by range.
    const list = (await s.sub.browser.get(`${s.base}/deliveries?status=cancelled`)).json().data;
    expect(list).toHaveLength(1);
  });

  it('keeps one project’s deliveries from another organisation', async () => {
    const a = await setup('logi-iso-a');
    const b = await setup('logi-iso-b');
    const dock = (
      await a.sm.browser.post(`${a.base}/logistics/resources`, { name: 'Dock', kind: 'dock' })
    ).json();
    const d = await a.sm.browser.post(`${a.base}/deliveries`, {
      title: 'Timber',
      supplierName: 'Mill',
      windowStart: inHours(1),
      windowEnd: inHours(2),
      zoneId: dock.id,
    });
    expect(d.statusCode).toBe(201);
    expect(
      (await b.pm.browser.get(`${a.base}/deliveries/${d.json().id}`)).statusCode,
    ).toBeGreaterThanOrEqual(403);
    expect((await b.pm.browser.get(`${b.base}/deliveries`)).json().data).toHaveLength(0);
  });
});
