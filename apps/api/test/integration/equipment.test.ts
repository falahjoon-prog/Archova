import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createProject, createTestContext, signUp, type TestContext } from './helpers';

// Equipment register (plan: workforce and equipment): org-level items that sit at one project at a time, with an
// append-only usage log.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

async function setup(label: string) {
  const u = await signUp(t.app, `${label}-owner`);
  const org = await createOrg(u.browser, `${label} Builder`);
  const project = await createProject(u.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  return { u, org, project, base: `/v1/orgs/${org.id}/equipment` };
}

describe('equipment register', () => {
  it('adds, finds, moves and retires equipment, with asset numbers unique within the org', async () => {
    const s = await setup('eq-reg');
    const made = await s.u.browser.post(s.base, {
      name: '5t excavator',
      assetNumber: 'EX-01',
      type: 'Excavator',
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      status: 'available',
      currentProjectId: null,
      totalHours: '0.00',
    });
    const id = made.json().id as string;

    const dup = await s.u.browser.post(s.base, {
      name: 'Other',
      assetNumber: 'ex-01',
      type: 'Excavator',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('workforce_equipment.asset_number_taken');

    // Sending a project puts it to work there.
    const moved = await s.u.browser.patch(
      `${s.base}/${id}`,
      { currentProjectId: s.project.id },
      { 'if-match': etagOf(made) },
    );
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ status: 'in_use', currentProjectId: s.project.id });

    // A stale version is refused.
    const stale = await s.u.browser.patch(
      `${s.base}/${id}`,
      { name: 'Renamed' },
      { 'if-match': etagOf(made) },
    );
    expect(stale.statusCode).toBe(412);

    // In use needs a project; another status takes it off site.
    const bad = await s.u.browser.patch(
      `${s.base}/${id}`,
      { status: 'in_use', currentProjectId: null },
      { 'if-match': etagOf(moved) },
    );
    expect(bad.statusCode).toBe(422);
    const serviced = await s.u.browser.patch(
      `${s.base}/${id}`,
      { status: 'maintenance' },
      { 'if-match': etagOf(moved) },
    );
    expect(serviced.json()).toMatchObject({ status: 'maintenance', currentProjectId: null });

    // Unknown projects are refused.
    const ghost = await s.u.browser.patch(
      `${s.base}/${id}`,
      { currentProjectId: 'prj_00000000000000000000000000' },
      { 'if-match': etagOf(serviced) },
    );
    expect(ghost.statusCode).toBeGreaterThanOrEqual(400);

    const retired = await s.u.browser.patch(
      `${s.base}/${id}`,
      { status: 'retired' },
      { 'if-match': etagOf(serviced) },
    );
    expect(retired.json().status).toBe('retired');
    expect((await s.u.browser.get(s.base)).json().data).toEqual([]);
    expect((await s.u.browser.get(`${s.base}?includeRetired=true`)).json().data).toHaveLength(1);
    expect((await s.u.browser.get(`${s.base}?status=retired`)).json().data).toHaveLength(1);
  });

  it('keeps an append-only usage log whose total cannot go below zero', async () => {
    const s = await setup('eq-log');
    const made = await s.u.browser.post(s.base, {
      name: 'Roller',
      assetNumber: 'RL-1',
      type: 'Roller',
    });
    const id = made.json().id as string;
    const logs = `${s.base}/${id}/logs`;

    const first = await s.u.browser.post(logs, {
      projectId: s.project.id,
      loggedOn: '2026-11-03',
      hours: '7.5',
      operator: 'Sam',
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ hours: '7.50', operator: 'Sam', loggedOn: '2026-11-03' });
    await s.u.browser.post(logs, { projectId: s.project.id, loggedOn: '2026-11-04', hours: '2' });
    expect((await s.u.browser.get(`${s.base}/${id}`)).json().totalHours).toBe('9.50');

    // Corrections are negative entries and cannot take the total below zero.
    const fix = await s.u.browser.post(logs, {
      projectId: s.project.id,
      loggedOn: '2026-11-03',
      hours: '-1.5',
      notes: 'Booked the wrong day',
    });
    expect(fix.statusCode).toBe(201);
    expect((await s.u.browser.get(`${s.base}/${id}`)).json().totalHours).toBe('8.00');
    const under = await s.u.browser.post(logs, {
      projectId: s.project.id,
      loggedOn: '2026-11-03',
      hours: '-9',
    });
    expect(under.statusCode).toBe(422);
    expect(under.json().code).toBe('workforce_equipment.hours_below_zero');

    // Not zero, not more than a day, a real date, a real project.
    for (const body of [
      { hours: '0' },
      { hours: '25' },
      { hours: 'abc' },
      { loggedOn: '2026-13-40' },
    ])
      expect(
        (
          await s.u.browser.post(logs, {
            projectId: s.project.id,
            loggedOn: '2026-11-03',
            hours: '1',
            ...body,
          })
        ).statusCode,
      ).toBe(422);

    const list = await s.u.browser.get(`${logs}?from=2026-11-04`);
    expect(list.json().data).toHaveLength(1);
    expect(
      (await s.u.browser.get(logs)).json().data.map((l: { loggedOn: string }) => l.loggedOn),
    ).toEqual(['2026-11-04', '2026-11-03', '2026-11-03']);

    // Retired equipment takes no more hours.
    await s.u.browser.patch(
      `${s.base}/${id}`,
      { status: 'retired' },
      { 'if-match': etagOf(await s.u.browser.get(`${s.base}/${id}`)) },
    );
    const late = await s.u.browser.post(logs, {
      projectId: s.project.id,
      loggedOn: '2026-11-05',
      hours: '1',
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('workforce_equipment.retired');
  });

  it("never shows one organisation's equipment to another", async () => {
    const a = await setup('eq-iso-a');
    const b = await setup('eq-iso-b');
    const made = await a.u.browser.post(a.base, {
      name: 'Crane',
      assetNumber: 'CR-1',
      type: 'Crane',
    });
    const id = made.json().id as string;
    expect((await b.u.browser.get(b.base)).json().data).toEqual([]);
    expect((await b.u.browser.get(`${b.base}/${id}`)).statusCode).toBe(404);
    expect((await b.u.browser.get(`${a.base}`)).statusCode).toBeGreaterThanOrEqual(403);
  });
});
