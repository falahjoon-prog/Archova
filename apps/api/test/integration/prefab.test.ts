import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadFile,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sm = await signUp(t.app, `${label}-sm`);
  const org = await createOrg(pm.browser, `${label} Builder`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}/prefab`;
  await addMember(pm.browser, org.id, project.id, sm.email, 'Site Manager', `${label} Builder`);
  return { pm, sm, base };
}

describe('Prefabricated and modular units', () => {
  it('takes a unit from planned to installed through its QA gates', async () => {
    const s = await setup('pfab');
    const create = await s.sm.browser.post(`${s.base}/units`, {
      code: 'BP-L3-01',
      name: 'Level 3 bathroom pod',
      kind: 'bathroom_pod',
      factoryName: 'PodWorks',
      installSequence: 1,
      installDate: '2030-01-15',
    });
    expect(create.statusCode).toBe(201);
    const unit = create.json();
    expect(unit).toMatchObject({ number: 1, status: 'planned', qaFailed: 0 });
    expect(unit.qaTotal).toBeGreaterThan(5);
    const u = `${s.base}/units/${unit.id}`;
    const act = (action: string, reason?: string) =>
      s.sm.browser.post(`${u}/transitions`, { action, ...(reason ? { reason } : {}) });

    // A duplicate code is refused, and a unit cannot skip a step.
    expect(
      (await s.sm.browser.post(`${s.base}/units`, { code: 'BP-L3-01', name: 'x', kind: 'other' }))
        .statusCode,
    ).toBe(409);
    expect((await act('ship')).statusCode).toBe(409);

    expect((await act('start')).json().status).toBe('in_fabrication');
    // The factory gate stops the unit leaving until the required checks pass.
    expect((await act('ready')).statusCode).toBe(409);

    const detail = (await s.sm.browser.get(u)).json();
    const factory = detail.checks.filter((c: { stage: string }) => c.stage === 'factory');
    // A failure needs a reason, and puts a unit still being made on QA hold.
    const bad = `${u}/checks/${factory[0].id}`;
    expect((await s.sm.browser.patch(bad, { result: 'fail' })).statusCode).toBe(422);
    expect(
      (await s.sm.browser.patch(bad, { result: 'fail', note: 'Out of square' })).statusCode,
    ).toBe(200);
    const held = (await s.sm.browser.get(u)).json().unit;
    expect(held).toMatchObject({ status: 'qa_hold', qaFailed: 1 });
    expect(held.statusReason).toContain('Out of square');

    // Rework, then pass everything at the factory.
    expect((await act('resume')).json().status).toBe('in_fabrication');
    for (const c of factory) await s.sm.browser.patch(`${u}/checks/${c.id}`, { result: 'pass' });
    expect((await act('ready')).json()).toMatchObject({
      status: 'ready_to_ship',
      progressPct: 100,
    });
    expect((await act('ship')).json().shippedAt).toBeTruthy();
    expect((await act('deliver')).json().status).toBe('on_site');

    // The site gate: install needs the site checks.
    expect((await act('install')).statusCode).toBe(409);
    const site = (await s.sm.browser.get(u))
      .json()
      .checks.filter((c: { stage: string }) => c.stage === 'site');
    for (const c of site) await s.sm.browser.patch(`${u}/checks/${c.id}`, { result: 'pass' });
    expect((await act('install')).json()).toMatchObject({ status: 'installed' });

    const history = (await s.sm.browser.get(u)).json().events.map((e: { kind: string }) => e.kind);
    expect(history).toEqual(
      expect.arrayContaining(['created', 'started', 'held', 'shipped', 'installed']),
    );
  });

  it('flags trouble, plans dates back from install and rejects a unit with a reason', async () => {
    const s = await setup('pfnv');
    const mk = async (code: string, extra: object) =>
      (
        await s.sm.browser.post(`${s.base}/units`, {
          code,
          name: code,
          kind: 'wall_panel',
          ...extra,
        })
      ).json();
    const late = await mk('WP-1', { fabDue: '2020-01-10', installSequence: 1 });
    await s.sm.browser.post(`${s.base}/units/${late.id}/transitions`, { action: 'start' });
    const bare = await mk('WP-2', { installSequence: 2 });

    const insights = (await s.pm.browser.get(`${s.base}/insights`)).json();
    expect(insights.summary.total).toBe(2);
    expect(insights.summary.byStatus.in_fabrication).toBe(1);
    expect(insights.flags.map((f: { kind: string }) => f.kind)).toContain('fab_late');

    const plan = (
      await s.pm.browser.post(`${s.base}/plan-dates`, {
        installDate: '2030-01-14',
        kind: 'bathroom_pod',
      })
    ).json();
    expect(plan).toMatchObject({
      installDate: '2030-01-14',
      deliveryDate: '2030-01-11',
      fabDays: 5,
    });

    const u = `${s.base}/units/${bare.id}`;
    expect((await s.sm.browser.post(`${u}/transitions`, { action: 'start' })).statusCode).toBe(200);
    expect((await s.sm.browser.post(`${u}/transitions`, { action: 'reject' })).statusCode).toBe(
      422,
    );
    const rejected = await s.sm.browser.post(`${u}/transitions`, {
      action: 'reject',
      reason: 'Damaged in transit',
    });
    expect(rejected.json()).toMatchObject({
      status: 'rejected',
      statusReason: 'Damaged in transit',
    });
    expect((await s.sm.browser.post(`${u}/transitions`, { action: 'reopen' })).json().status).toBe(
      'planned',
    );

    // Dates must run forwards, and a link to another project's delivery is refused.
    expect(
      (await s.sm.browser.patch(u, { fabStart: '2030-02-02', fabDue: '2030-02-01' })).statusCode,
    ).toBe(422);
    const patched = await s.sm.browser.patch(u, {
      shipDate: '2030-03-01',
      clear: ['installSequence'],
    });
    expect(patched.json()).toMatchObject({ shipDate: '2030-03-01', installSequence: null });

    // A draft delivery is booked for the day the unit is due on site, and only once.
    const drafted = await s.pm.browser.post(`${s.base}/units/${late.id}/draft-delivery`);
    expect(drafted.statusCode).toBe(422);
    await s.pm.browser.patch(`${s.base}/units/${late.id}`, { installDate: '2030-04-02' });
    const booked = await s.pm.browser.post(`${s.base}/units/${late.id}/draft-delivery`);
    expect(booked.statusCode, booked.body).toBe(200);
    expect(booked.json().deliveryLabel).toContain('WP-1');
    expect(booked.json().deliveryId).toBeTruthy();
    expect((await s.pm.browser.post(`${s.base}/units/${late.id}/draft-delivery`)).statusCode).toBe(
      409,
    );
  });

  it('ties a unit to a programme activity and shows it from both sides', async () => {
    const s = await setup('pfpg');
    const root = s.base.replace(/\/prefab$/, '');
    const unit = (
      await s.sm.browser.post(`${s.base}/units`, {
        code: 'WP-9',
        name: 'Level 2 wall panel',
        kind: 'wall_panel',
        installDate: '2030-03-07',
      })
    ).json();
    const sched = (await s.pm.browser.post(`${root}/schedules`, { name: 'Master' })).json();
    const act = (
      await s.pm.browser.post(`${root}/schedules/${sched.schedule.id}/activities`, {
        name: 'Erect panels',
        start: '2030-03-07',
        finish: '2030-03-08',
      })
    ).json().activities[0];
    const url = `${root}/schedules/${sched.schedule.id}/activities/${act.id}/links`;
    const link = await s.pm.browser.post(url, { kind: 'prefab_unit', targetId: unit.id });
    expect(link.statusCode).toBe(201);
    expect(link.json()).toMatchObject({
      kind: 'prefab_unit',
      visible: true,
      ref: 'WP-9',
      title: 'Level 2 wall panel',
      status: 'planned',
      dueDate: '2030-03-07',
    });
    expect(
      (await s.pm.browser.post(url, { kind: 'prefab_unit', targetId: unit.id })).statusCode,
    ).toBe(409);
    const back = (
      await s.pm.browser.get(`${root}/schedule-links?kind=prefab_unit&targetId=${unit.id}`)
    ).json();
    expect(back.data).toHaveLength(1);
    expect(back.data[0].activityName).toBe('Erect panels');
  });

  it('keeps photos on a QA check, and refuses a file from another project', async () => {
    const s = await setup('pfph');
    const [, , , orgId, , projectId] = s.base.split('/');
    const unit = (
      await s.sm.browser.post(`${s.base}/units`, {
        code: 'BP-1',
        name: 'Pod',
        kind: 'bathroom_pod',
      })
    ).json();
    const check = (await s.sm.browser.get(`${s.base}/units/${unit.id}`)).json().checks[0];
    const url = `${s.base}/units/${unit.id}/checks/${check.id}`;

    const photo = await uploadFile(t, s.sm.browser, orgId!, projectId!, 'pod.jpg', 'prefab');
    const withPhoto = await s.sm.browser.patch(url, { result: 'pass', fileIds: [photo] });
    expect(withPhoto.statusCode).toBe(200);
    expect(withPhoto.json().fileIds).toEqual([photo]);

    // Recording again without a list leaves the photos alone; an empty list clears them.
    expect((await s.sm.browser.patch(url, { result: 'na' })).json().fileIds).toEqual([photo]);
    expect((await s.sm.browser.patch(url, { result: 'na', fileIds: [] })).json().fileIds).toEqual(
      [],
    );

    // A file uploaded to another project of the same org is not attachable here, even by someone who can see both.
    const other = await createProject(s.pm.browser, orgId!, { name: 'Other', state: 'QLD' });
    const foreign = await uploadFile(t, s.pm.browser, orgId!, other.id, 'x.pdf');
    const bad = await s.pm.browser.patch(url, { result: 'pass', fileIds: [foreign] });
    expect(bad.statusCode).toBe(422);
    expect((await s.sm.browser.patch(url, { result: 'pass', fileIds: ['nope'] })).statusCode).toBe(
      422,
    );
  });

  it('keeps a factory list per project and leaves units with the name they were given', async () => {
    const s = await setup('pfac');
    const f = `${s.base}/factories`;
    const made = await s.sm.browser.post(f, { name: 'PodWorks', location: 'Wacol QLD' });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ name: 'PodWorks', location: 'Wacol QLD', contact: null });
    // The same name in any case is refused.
    expect((await s.sm.browser.post(f, { name: 'podworks' })).statusCode).toBe(409);
    expect((await s.sm.browser.post(f, { name: 'Panel Co' })).statusCode).toBe(201);
    const list = (await s.sm.browser.get(f)).json().data;
    expect(list.map((x: { name: string }) => x.name)).toEqual(['Panel Co', 'PodWorks']);

    const unit = await s.sm.browser.post(`${s.base}/units`, {
      code: 'WP-01',
      name: 'Wall panel',
      kind: 'wall_panel',
      factoryName: 'PodWorks',
    });
    expect(unit.statusCode).toBe(201);

    // Removing a factory leaves the unit's factory name alone, and a second removal is a 404.
    const del = await s.sm.browser.del(`${f}/${made.json().id}`);
    expect(del.statusCode).toBe(204);
    expect((await s.sm.browser.del(`${f}/${made.json().id}`)).statusCode).toBe(404);
    expect(
      (await s.sm.browser.get(`${s.base}/units/${unit.json().id}`)).json().unit.factoryName,
    ).toBe('PodWorks');

    // Another project does not see this list.
    const other = await createProject(s.pm.browser, s.base.split('/')[3]!, {
      name: 'Other',
      state: 'QLD',
    });
    const theirs = await s.pm.browser.get(
      `/v1/orgs/${s.base.split('/')[3]}/projects/${other.id}/prefab/factories`,
    );
    expect(theirs.json().data).toEqual([]);
  });
});
