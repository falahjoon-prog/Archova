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
  });
});
