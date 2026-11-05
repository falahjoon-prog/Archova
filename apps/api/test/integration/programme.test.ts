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

type Detail = {
  schedule: {
    id: string;
    source: string;
    activityCount: number;
    startDate: string | null;
    finishDate: string | null;
  };
  activities: Array<{
    id: string;
    name: string;
    kind: string;
    start: string;
    finish: string;
    durationDays: number;
    floatDays: number;
    critical: boolean;
  }>;
  dependencies: Array<{ id: string; slackDays: number; violated: boolean; type: string }>;
  criticalCount: number;
  violationCount: number;
};

async function setup() {
  const pm = await signUp(t.app, 'prog-pm');
  const sub = await signUp(t.app, 'prog-sub');
  const org = await createOrg(pm.browser, 'Programme Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower P', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sparky');
  return { pm, sub, org, project, base };
}

describe('Programme: Gantt, float, import and look-ahead (product/08 S4/S5)', () => {
  it('builds a programme, links activities, refuses loops and computes the critical path', async () => {
    const s = await setup();
    const created = await s.pm.browser.post(`${s.base}/schedules`, { name: 'Master programme' });
    expect(created.statusCode).toBe(201);
    const sid = (created.json() as Detail).schedule.id;

    const add = async (body: Record<string, unknown>) => {
      const r = await s.pm.browser.post(`${s.base}/schedules/${sid}/activities`, body);
      expect(r.statusCode).toBe(201);
      return r.json() as Detail;
    };
    await add({ name: 'Slab', start: '2030-03-04', finish: '2030-03-06' });
    await add({ name: 'Frame', start: '2030-03-07', finish: '2030-03-08' });
    const d = await add({
      name: 'Services rough-in',
      start: '2030-03-07',
      finish: '2030-03-07',
      assignee: 'Sparky',
    });
    const [slab, frame, services] = d.activities.map((a) => a.id) as [string, string, string];
    await add({
      name: 'Frame complete',
      kind: 'milestone',
      start: '2030-03-08',
      finish: '2030-03-20',
    });

    const link = (p: string, q: string, extra: Record<string, unknown> = {}) =>
      s.pm.browser.post(`${s.base}/schedules/${sid}/dependencies`, {
        predecessorId: p,
        successorId: q,
        ...extra,
      });
    expect((await link(slab, frame)).statusCode).toBe(201);
    const withBoth = await link(slab, services);
    expect(withBoth.statusCode).toBe(201);
    expect((await link(slab, frame)).statusCode).toBe(409); // already linked
    expect((await link(frame, slab)).statusCode).toBe(409); // a loop

    const detail = (await s.pm.browser.get(`${s.base}/schedules/${sid}`)).json() as Detail;
    const byName = Object.fromEntries(detail.activities.map((a) => [a.name, a]));
    expect(byName['Frame complete']!.finish).toBe('2030-03-08'); // a milestone is a single day
    expect(byName['Slab']).toMatchObject({ durationDays: 3, critical: true });
    expect(byName['Frame']).toMatchObject({ critical: true, floatDays: 0 });
    expect(byName['Services rough-in']!.floatDays).toBe(1);
    expect(detail.violationCount).toBe(0);

    // Dragging the slab later than the frame breaks the link and the response says so.
    const moved = await s.pm.browser.patch(`${s.base}/schedules/${sid}/activities/${slab}`, {
      start: '2030-03-06',
    });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as Detail).violationCount).toBe(2);
    const bad = await s.pm.browser.patch(`${s.base}/schedules/${sid}/activities/${slab}`, {
      finish: '2030-03-01',
    });
    expect(bad.statusCode).toBe(422);

    const first = (moved.json() as Detail).dependencies[0]!;
    const unlinked = await s.pm.browser.del(`${s.base}/schedules/${sid}/dependencies/${first.id}`);
    expect(unlinked.statusCode).toBe(200);
    expect((unlinked.json() as Detail).dependencies).toHaveLength(1);
    const gone = await s.pm.browser.del(`${s.base}/schedules/${sid}/activities/${services}`);
    expect((gone.json() as Detail).activities).toHaveLength(3);
  });

  it('imports MS Project XML and P6 XER, and keeps a revision list', async () => {
    const s = await setup();
    const msp = `<Project><Title>Imported</Title><Tasks>
<Task><UID>1</UID><Name>Excavate</Name><Start>2030-03-04T08:00:00</Start><Finish>2030-03-08T17:00:00</Finish></Task>
<Task><UID>2</UID><Name>Footings</Name><Start>2030-03-11T08:00:00</Start><Finish>2030-03-13T17:00:00</Finish>
<PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type></PredecessorLink></Task></Tasks></Project>`;
    const imp = await s.pm.browser.post(`${s.base}/schedules/import`, {
      format: 'msp',
      content: msp,
    });
    expect(imp.statusCode).toBe(201);
    const body = imp.json() as { detail: Detail; skipped: string[] };
    expect(body.detail.schedule).toMatchObject({
      source: 'msp',
      activityCount: 2,
      startDate: '2030-03-04',
      finishDate: '2030-03-13',
    });
    expect(body.detail.dependencies).toHaveLength(1);

    const xer = [
      'ERMHDR\t20.12',
      '%T\tTASK',
      '%F\ttask_id\ttask_name\ttask_type\ttarget_start_date\ttarget_end_date',
      '%R\t1\tPour\tTT_Task\t2030-03-04 08:00\t2030-03-05 17:00',
      '%E',
    ].join('\n');
    const p6 = await s.pm.browser.post(`${s.base}/schedules/import`, {
      format: 'p6',
      content: xer,
      name: 'P6 rev B',
    });
    expect(p6.statusCode).toBe(201);
    expect((p6.json() as { detail: Detail }).detail.schedule.source).toBe('p6');

    const wrong = await s.pm.browser.post(`${s.base}/schedules/import`, {
      format: 'p6',
      content: msp,
    });
    expect(wrong.statusCode).toBe(422);

    const list = (await s.pm.browser.get(`${s.base}/schedules`)).json() as {
      data: Array<{ name: string }>;
    };
    expect(list.data.map((x) => x.name)).toEqual(['P6 rev B', 'Imported']);

    const del = await s.pm.browser.del(`${s.base}/schedules/${body.detail.schedule.id}`);
    expect(del.statusCode).toBe(204);
    expect(
      (await s.pm.browser.get(`${s.base}/schedules/${body.detail.schedule.id}`)).statusCode,
    ).toBe(404);
  });

  it('serves the look-ahead to the team and lets a subcontractor read but not change the programme', async () => {
    const s = await setup();
    const created = (
      await s.pm.browser.post(`${s.base}/schedules`, { name: 'Lookahead' })
    ).json() as Detail;
    const sid = created.schedule.id;
    await s.pm.browser.post(`${s.base}/schedules/${sid}/activities`, {
      name: 'Soon',
      start: '2030-03-05',
      finish: '2030-03-08',
      assignee: 'Sparky',
    });
    await s.pm.browser.post(`${s.base}/schedules/${sid}/activities`, {
      name: 'Far',
      start: '2030-06-03',
      finish: '2030-06-07',
    });

    const la = await s.pm.browser.get(
      `${s.base}/schedules/${sid}/lookahead?weeks=3&from=2030-03-05`,
    );
    expect(la.statusCode).toBe(200);
    const body = la.json() as {
      windowStart: string;
      windowEnd: string;
      items: Array<{ activity: { name: string }; late: boolean }>;
    };
    expect(body.windowStart).toBe('2030-03-04');
    expect(body.windowEnd).toBe('2030-03-24');
    expect(body.items.map((i) => i.activity.name)).toEqual(['Soon']);
    expect(
      (await s.pm.browser.get(`${s.base}/schedules/${sid}/lookahead?weeks=9`)).statusCode,
    ).toBe(422);

    expect((await s.sub.browser.get(`${s.base}/schedules/${sid}/lookahead`)).statusCode).toBe(200);
    expect((await s.sub.browser.get(`${s.base}/schedules/${sid}`)).statusCode).toBe(200);
    const write = await s.sub.browser.post(`${s.base}/schedules/${sid}/activities`, {
      name: 'Nope',
      start: '2030-03-05',
    });
    expect(write.statusCode).toBe(403);
    expect((await s.sub.browser.del(`${s.base}/schedules/${sid}`)).statusCode).toBe(403);
  });

  it("keeps one organisation out of another organisation's programme", async () => {
    const a = await setup();
    const b = await setup();
    const sid = (
      (await a.pm.browser.post(`${a.base}/schedules`, { name: 'Private' })).json() as Detail
    ).schedule.id;
    const peek = await b.pm.browser.get(`${a.base}/schedules/${sid}`);
    expect([403, 404]).toContain(peek.statusCode);
    const own = await b.pm.browser.get(`${b.base}/schedules/${sid}`);
    expect(own.statusCode).toBe(404);
  });

  it('ties RFIs and submittals to an activity, hides what the caller cannot see and refuses duplicates (SCH-US10)', async () => {
    const s = await setup();
    const sid = (
      (await s.pm.browser.post(`${s.base}/schedules`, { name: 'Linked' })).json() as Detail
    ).schedule.id;
    const detail = (await (
      await s.pm.browser.post(`${s.base}/schedules/${sid}/activities`, {
        name: 'Slab pour',
        start: '2030-03-04',
        finish: '2030-03-06',
      })
    ).json()) as Detail;
    const aid = detail.activities[0]!.id;
    const rfi = (
      await s.pm.browser.post(`${s.base}/rfis`, {
        subject: 'Slab edge detail',
        question: 'Which governs?',
      })
    ).json().rfi as { id: string };
    const submittal = (
      await s.pm.browser.post(`${s.base}/submittals`, {
        title: 'Slab reinforcement',
        type: 'shop_drawing',
        requiredOnSite: '2030-03-01',
      })
    ).json().submittal as { id: string };

    const url = `${s.base}/schedules/${sid}/activities/${aid}/links`;
    const l1 = await s.pm.browser.post(url, { kind: 'rfi', targetId: rfi.id });
    expect(l1.statusCode).toBe(201);
    expect(l1.json()).toMatchObject({
      kind: 'rfi',
      visible: true,
      title: 'Slab edge detail',
      ref: 'Draft',
    });
    const l2 = await s.pm.browser.post(url, { kind: 'submittal', targetId: submittal.id });
    expect(l2.statusCode).toBe(201);
    expect(l2.json()).toMatchObject({ kind: 'submittal', visible: true, dueDate: '2030-03-01' });

    expect((await s.pm.browser.post(url, { kind: 'rfi', targetId: rfi.id })).statusCode).toBe(409);
    // A submittal id is not an RFI id, and an unknown RFI is refused.
    expect((await s.pm.browser.post(url, { kind: 'rfi', targetId: submittal.id })).statusCode).toBe(
      422,
    );
    const other = await setup();
    const foreign = (
      await other.pm.browser.post(`${other.base}/rfis`, { subject: 'Not yours', question: 'x' })
    ).json().rfi as { id: string };
    expect((await s.pm.browser.post(url, { kind: 'rfi', targetId: foreign.id })).statusCode).toBe(
      422,
    );

    const list = await s.pm.browser.get(`${s.base}/schedules/${sid}/links`);
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data).toHaveLength(2);

    // A subcontractor reads the programme but can't see the builder's draft RFI or submittal, and can't change links.
    const subList = (await s.sub.browser.get(`${s.base}/schedules/${sid}/links`)).json() as {
      data: Array<{ visible: boolean; title: string | null }>;
    };
    expect(subList.data.map((l) => [l.visible, l.title])).toEqual([
      [false, null],
      [false, null],
    ]);
    expect((await s.sub.browser.post(url, { kind: 'rfi', targetId: rfi.id })).statusCode).toBe(403);

    const linkId = (l1.json() as { id: string }).id;
    expect((await s.sub.browser.del(`${s.base}/schedules/${sid}/links/${linkId}`)).statusCode).toBe(
      403,
    );
    expect((await s.pm.browser.del(`${s.base}/schedules/${sid}/links/${linkId}`)).statusCode).toBe(
      204,
    );
    expect((await s.pm.browser.del(`${s.base}/schedules/${sid}/links/${linkId}`)).statusCode).toBe(
      404,
    );

    // Removing the activity removes its links.
    await s.pm.browser.del(`${s.base}/schedules/${sid}/activities/${aid}`);
    const after = (await s.pm.browser.get(`${s.base}/schedules/${sid}/links`)).json() as {
      data: unknown[];
    };
    expect(after.data).toHaveLength(0);
  });
});
