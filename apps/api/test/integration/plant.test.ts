import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
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

  it('posts finished hire days to the project budget once, and only for hired machines with a cost code', async () => {
    const ana = await signUp(t.app, 'plant-post');
    const org = await createOrg(ana.browser, 'Plant Posting');
    const project = await createProject(ana.browser, org.id);
    const pBase = `/v1/orgs/${org.id}/projects/${project.id}`;
    const base = `/v1/orgs/${org.id}/plant`;
    const code = (
      await ana.browser.post(`${pBase}/cost-codes`, { code: '07', description: 'Plant hire' })
    ).json() as { id: string };
    const noLineCode = (
      await ana.browser.post(`${pBase}/cost-codes`, { code: '08', description: 'Unbudgeted' })
    ).json() as { id: string };
    await ana.browser.post(`${pBase}/budget`);
    const line = (
      await ana.browser.post(`${pBase}/budget/lines`, { costCodeId: code.id, original: '10000.00' })
    ).json() as { id: string };
    const actualOf = async () =>
      (
        (await ana.browser.get(`${pBase}/budget`)).json() as {
          lines: Array<{ id: string; actual: string }>;
        }
      ).lines.find((l) => l.id === line.id)!.actual;

    const mk = async (assetNumber: string, ownership: 'hired' | 'owned') =>
      (
        await ana.browser.post(`${base}/assets`, {
          name: assetNumber,
          assetNumber,
          category: 'crane',
          ownership,
          ...(ownership === 'hired' ? { supplier: 'Coates' } : {}),
          dailyRateCents: 50000,
        })
      ).json() as { id: string };
    const hired = await mk('CR-H', 'hired');
    const owned = await mk('CR-O', 'owned');
    const alloc = async (assetId: string, costCodeId: string | null) =>
      ana.browser.post(`${base}/assets/${assetId}/allocations`, {
        projectId: project.id,
        startsOn: '2026-01-05',
        endsOn: '2026-01-09',
        ...(costCodeId ? { costCodeId } : {}),
      });
    expect((await alloc(hired.id, code.id)).statusCode).toBe(201);
    expect((await alloc(owned.id, code.id)).statusCode).toBe(201);
    const noLine = await ana.browser.post(
      `${base}/assets/${(await mk('CR-N', 'hired')).id}/allocations`,
      {
        projectId: project.id,
        startsOn: '2026-01-05',
        endsOn: '2026-01-06',
        costCodeId: noLineCode.id,
      },
    );
    expect(noLine.statusCode).toBe(201);

    // A costed allocation must stay inside the project's own budget and inside a sane date range.
    const other = await createProject(ana.browser, org.id);
    const foreignCode = (
      await ana.browser.post(`/v1/orgs/${org.id}/projects/${other.id}/cost-codes`, {
        code: '09',
        description: 'Elsewhere',
      })
    ).json() as { id: string };
    const bad = async (body: Record<string, unknown>) =>
      (
        await ana.browser.post(`${base}/assets/${hired.id}/allocations`, {
          projectId: project.id,
          costCodeId: code.id,
          startsOn: '2030-01-01',
          endsOn: '2030-01-02',
          ...body,
        })
      ).statusCode;
    expect(await bad({ costCodeId: foreignCode.id })).toBe(422);
    expect(await bad({ startsOn: '2020-01-01', endsOn: '2020-01-05' })).toBe(422);
    expect(await bad({ startsOn: '2030-01-01', endsOn: '2032-01-01' })).toBe(422);

    const run = () =>
      t.database.withTenantTx(
        {
          orgId: decodeId('org', org.id)!,
          userId: decodeId('user', ana.userId)!,
          principalType: 'member' as const,
          orgRole: 'owner' as const,
          entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
          requestId: 'test',
        },
        (scope) => t.modules.plant.api.postHireCosts(scope),
      );
    // Five days of the hired crane at $500: $2,500 on the budget line. The owned machine and the code with no
    // budget line post nothing, and the unbudgeted hire waits.
    expect(await run()).toEqual({ posted: 1, waiting: 1, skipped: 0 });
    expect(await actualOf()).toBe('2500.00');
    expect(await run()).toEqual({ posted: 0, waiting: 1, skipped: 0 });
    expect(await actualOf()).toBe('2500.00');
    const list = (await ana.browser.get(`${base}/allocations`)).json() as {
      data: Array<{ assetId: string; postedThrough: string | null }>;
    };
    expect(list.data.find((a) => a.assetId === hired.id)!.postedThrough).toBe('2026-01-09');
    expect(list.data.find((a) => a.assetId === owned.id)!.postedThrough).toBeNull();
  });
});
