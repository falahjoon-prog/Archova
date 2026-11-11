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

type Asset = { id: string; dailyRateCents: number | null; status: string };
type Alloc = { id: string; estimatedCostCents: number | null; status: string };
type Plan = { id: string; nextDueOn: string | null; active: boolean; state: string | null };

describe('plant and equipment', () => {
  it('registers a fleet, refuses double allocation, moves maintenance on and flags what is wrong', async () => {
    const ana = await signUp(t.app, 'plant-ana');
    const org = await createOrg(ana.browser, 'Plant Builders');
    const project = await createProject(ana.browser, org.id);
    const base = `/v1/orgs/${org.id}/plant`;

    const created = await ana.browser.post(`${base}/assets`, {
      name: '20t excavator',
      assetNumber: 'EX-20',
      category: 'excavator',
      ownership: 'hired',
      supplier: 'Coates',
      dailyRateCents: 45000,
    });
    expect(created.statusCode).toBe(201);
    const asset = created.json() as Asset;
    expect(asset.dailyRateCents).toBe(45000);
    expect(
      (
        await ana.browser.post(`${base}/assets`, {
          name: 'Another',
          assetNumber: 'EX-20',
          category: 'other',
          ownership: 'owned',
        })
      ).statusCode,
    ).toBe(409);

    // Allocation: a clash on any shared day is refused, a cancelled one frees the days.
    const alloc = (startsOn: string, endsOn: string) =>
      ana.browser.post(`${base}/assets/${asset.id}/allocations`, {
        projectId: project.id,
        startsOn,
        endsOn,
      });
    const first = await alloc('2026-12-01', '2026-12-05');
    expect(first.statusCode).toBe(201);
    const a1 = first.json() as Alloc;
    expect(a1.estimatedCostCents).toBe(5 * 45000);
    expect((await alloc('2026-12-05', '2026-12-08')).statusCode).toBe(409);
    expect((await alloc('2026-12-06', '2026-12-08')).statusCode).toBe(201);
    expect((await ana.browser.post(`${base}/allocations/${a1.id}/cancel`, {})).statusCode).toBe(
      200,
    );
    expect((await alloc('2026-12-05', '2026-12-05')).statusCode).toBe(201);
    const listed = (
      await ana.browser.get(`${base}/allocations?from=2026-12-01&to=2026-12-31`)
    ).json() as { data: Alloc[] };
    expect(listed.data.filter((a) => a.status === 'active')).toHaveLength(2);

    // Utilisation counts the days once.
    const util = (
      await ana.browser.get(`${base}/utilisation?from=2026-12-01&to=2026-12-10`)
    ).json() as { fleetPct: number; assets: Array<{ bookedDays: number; costCents: number }> };
    expect(util.assets[0]).toMatchObject({ bookedDays: 3, costCents: 3 * 45000 });
    expect(util.fleetPct).toBe(30);

    // Maintenance: a recurring plan moves on from the day it was done; a one-off finishes.
    const plan = (
      await ana.browser.post(`${base}/assets/${asset.id}/maintenance-plans`, {
        title: '500 hour service',
        kind: 'service',
        intervalDays: 90,
        nextDueOn: '2020-01-01',
      })
    ).json() as Plan;
    expect(plan.state).toBe('overdue');
    const flags = (await ana.browser.get(`${base}/flags`)).json() as {
      data: Array<{ code: string; severity: string }>;
    };
    expect(flags.data[0]).toMatchObject({ code: 'maintenance_overdue', severity: 'critical' });
    const done = (
      await ana.browser.post(`${base}/maintenance-plans/${plan.id}/complete`, {
        doneOn: '2026-11-03',
      })
    ).json() as Plan;
    expect(done).toMatchObject({ nextDueOn: '2027-02-01', active: true });
    const once = (
      await ana.browser.post(`${base}/assets/${asset.id}/maintenance-plans`, {
        title: 'Crane certificate',
        kind: 'certification',
        nextDueOn: '2027-06-01',
      })
    ).json() as Plan;
    const finished = (
      await ana.browser.post(`${base}/maintenance-plans/${once.id}/complete`, {
        doneOn: '2026-11-03',
      })
    ).json() as Plan;
    expect(finished).toMatchObject({ nextDueOn: null, active: false, state: null });
    expect(
      (
        await ana.browser.post(`${base}/maintenance-plans/${once.id}/complete`, {
          doneOn: '2026-11-04',
        })
      ).statusCode,
    ).toBe(409);
    const records = (
      await ana.browser.get(`${base}/assets/${asset.id}/maintenance-records`)
    ).json() as { data: unknown[] };
    expect(records.data).toHaveLength(2);

    // A machine with allocations to come can't be retired; one in the workshop can't be allocated.
    expect(
      (await ana.browser.patch(`${base}/assets/${asset.id}`, { status: 'retired' })).statusCode,
    ).toBe(409);
    await ana.browser.patch(`${base}/assets/${asset.id}`, { status: 'maintenance' });
    expect((await alloc('2027-01-01', '2027-01-02')).statusCode).toBe(409);
  });

  it('keeps the fleet to the organisation’s own staff', async () => {
    const ana = await signUp(t.app, 'plant-own');
    const org = await createOrg(ana.browser, 'Plant Owners');
    const project = await createProject(ana.browser, org.id);
    const sub = await signUp(t.app, 'plant-sub');
    await addMember(ana.browser, org.id, project.id, sub.email, 'Subcontractor');
    const res = await sub.browser.get(`/v1/orgs/${org.id}/plant/assets`);
    expect(res.statusCode).toBe(403);
  });
});
