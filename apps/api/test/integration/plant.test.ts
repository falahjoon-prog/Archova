import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId } from '@archova/domain';
import { hexToBase64, quarantineKey } from '@archova/mod-files';
import type { Browser } from './helpers';
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
    // 5 Dec once, plus 6 to 8 Dec: four booked days of ten.
    expect(util.assets[0]).toMatchObject({ bookedDays: 4, costCents: 4 * 45000 });
    expect(util.fleetPct).toBe(40);

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
    // A costed allocation may only start within the last 31 days, so the dates move with the clock.
    const dayOffset = (n: number) =>
      new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const [hireStart, hireEnd, hireNext] = [
      dayOffset(-14),
      dayOffset(-10),
      dayOffset(-13),
    ] as const;
    const alloc = async (assetId: string, costCodeId: string | null) =>
      ana.browser.post(`${base}/assets/${assetId}/allocations`, {
        projectId: project.id,
        startsOn: hireStart,
        endsOn: hireEnd,
        ...(costCodeId ? { costCodeId } : {}),
      });
    expect((await alloc(hired.id, code.id)).statusCode).toBe(201);
    expect((await alloc(owned.id, code.id)).statusCode).toBe(201);
    const noLine = await ana.browser.post(
      `${base}/assets/${(await mk('CR-N', 'hired')).id}/allocations`,
      {
        projectId: project.id,
        startsOn: hireStart,
        endsOn: hireNext,
        costCodeId: noLineCode.id,
      },
    );
    // A code with no budget line on this project is refused up front, so nothing can wait for one.
    expect(noLine.statusCode).toBe(422);

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
    // Five days of the hired crane at $500: $2,500 on the budget line. The owned machine posts nothing.
    expect(await run()).toEqual({ posted: 1, waiting: 0, skipped: 0 });
    expect(await actualOf()).toBe('2500.00');
    expect(await run()).toEqual({ posted: 0, waiting: 0, skipped: 0 });
    expect(await actualOf()).toBe('2500.00');
    const list = (await ana.browser.get(`${base}/allocations`)).json() as {
      data: Array<{ assetId: string; postedThrough: string | null }>;
    };
    expect(list.data.find((a) => a.assetId === hired.id)!.postedThrough).toBe(hireEnd);
    expect(list.data.find((a) => a.assetId === owned.id)!.postedThrough).toBeNull();
  });

  /** An org-level photo (no project), the way the condition photos tab uploads one. */
  async function uploadPlantPhoto(
    browser: Browser,
    orgId: string,
    name: string,
    projectId?: string,
  ) {
    const content = `${name} ${Math.random()}`;
    const sha256 = createHash('sha256').update(content).digest('hex');
    const created = await browser.post(`/v1/orgs/${orgId}/uploads`, {
      filename: name,
      mime: 'image/jpeg',
      sizeBytes: content.length,
      sha256,
      module: 'plant',
      ...(projectId ? { projectId } : {}),
    });
    if (created.statusCode !== 201) return { status: created.statusCode, id: '' };
    const uploadId = (created.json() as { id: string }).id;
    t.store.put(quarantineKey(decodeId('upload', uploadId)!), content.length, hexToBase64(sha256));
    const done = await browser.post(`/v1/orgs/${orgId}/uploads/${uploadId}/complete`);
    return { status: done.statusCode, id: (done.json() as { id: string }).id };
  }

  it('keeps condition photos for hire-in, hire-out and a service, and refuses anyone else’s files', async () => {
    const ana = await signUp(t.app, 'plant-photos');
    const org = await createOrg(ana.browser, 'Plant Photos');
    const project = await createProject(ana.browser, org.id);
    const base = `/v1/orgs/${org.id}/plant`;
    const mk = async (assetNumber: string) =>
      (
        await ana.browser.post(`${base}/assets`, {
          name: assetNumber,
          assetNumber,
          category: 'crane',
          ownership: 'hired',
        })
      ).json() as Asset;
    const crane = await mk('CR-1');
    const other = await mk('CR-2');
    const url = `${base}/assets/${crane.id}/condition-checks`;

    const photo = await uploadPlantPhoto(ana.browser, org.id, 'in.jpg');
    expect(photo.status).toBe(200);
    const alloc = (
      await ana.browser.post(`${base}/assets/${crane.id}/allocations`, {
        projectId: project.id,
        startsOn: '2026-11-20',
        endsOn: '2026-11-21',
      })
    ).json() as Alloc;
    const hireIn = await ana.browser.post(url, {
      kind: 'hire_in',
      fileIds: [photo.id],
      note: 'Scratch on the left door',
      allocationId: alloc.id,
    });
    expect(hireIn.statusCode).toBe(201);
    expect(hireIn.json().fileIds).toEqual([photo.id]);
    expect(hireIn.json().allocationId).toBe(alloc.id);

    // A service photo can't name an allocation, and a hire photo can't name a service record.
    const p2 = await uploadPlantPhoto(ana.browser, org.id, 'svc.jpg');
    expect(
      (await ana.browser.post(url, { kind: 'service', fileIds: [p2.id], allocationId: alloc.id }))
        .statusCode,
    ).toBe(422);
    expect((await ana.browser.post(url, { kind: 'service', fileIds: [p2.id] })).statusCode).toBe(
      201,
    );

    // An allocation of another machine is refused.
    const otherAlloc = (
      await ana.browser.post(`${base}/assets/${other.id}/allocations`, {
        projectId: project.id,
        startsOn: '2026-11-25',
        endsOn: '2026-11-26',
      })
    ).json() as Alloc;
    expect(
      (
        await ana.browser.post(url, {
          kind: 'hire_out',
          fileIds: [photo.id],
          allocationId: otherAlloc.id,
        })
      ).statusCode,
    ).toBe(404);

    // No photos, or a file that isn't a plant photo, is refused.
    expect((await ana.browser.post(url, { kind: 'hire_in', fileIds: [] })).statusCode).toBe(422);
    const foreign = await uploadPlantPhoto(ana.browser, org.id, 'site.jpg', project.id);
    expect(foreign.status).toBe(200);
    expect(
      (await ana.browser.post(url, { kind: 'hire_in', fileIds: [foreign.id] })).statusCode,
    ).toBe(422);

    const list = (await ana.browser.get(url)).json() as { data: Array<{ kind: string }> };
    expect(list.data.map((c) => c.kind).sort()).toEqual(['hire_in', 'service']);
  });

  it('lets a subcontractor neither read nor add condition photos', async () => {
    const ana = await signUp(t.app, 'plant-ph-own');
    const org = await createOrg(ana.browser, 'Plant Photo Owners');
    const project = await createProject(ana.browser, org.id);
    const sub = await signUp(t.app, 'plant-ph-sub');
    await addMember(ana.browser, org.id, project.id, sub.email, 'Subcontractor');
    expect((await uploadPlantPhoto(sub.browser, org.id, 'x.jpg')).status).toBe(403);
  });
});
