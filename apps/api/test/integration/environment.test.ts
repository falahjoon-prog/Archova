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

async function setup() {
  const pm = await signUp(t.app, 'env-pm');
  const site = await signUp(t.app, 'env-site');
  const sub = await signUp(t.app, 'env-sub');
  const org = await createOrg(pm.browser, 'Green Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower E', state: 'VIC' });
  await addMember(pm.browser, org.id, project.id, site.email, 'Site Manager', 'Builder Crew');
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Dust Co');
  const base = `/v1/orgs/${org.id}/projects/${project.id}/environment`;
  return { pm, site, sub, org, project, base };
}

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;

describe('Environmental Management Plan', () => {
  it('starts empty, is created as a draft, edited, then approved with a review date', async () => {
    const s = await setup();
    expect((await s.pm.browser.get(`${s.base}/plan`)).json()).toEqual({ plan: null });

    const created = await s.pm.browser.post(`${s.base}/plan`, {
      title: 'Tower E EMP',
      permitReference: 'PL-2026-114',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: 'draft', reviewIntervalMonths: 6 });
    // One plan per project.
    expect((await s.pm.browser.post(`${s.base}/plan`, { title: 'Again' })).statusCode).toBe(409);

    const edited = await s.pm.browser.patch(
      `${s.base}/plan`,
      { summary: 'Dust and noise are the main risks.' },
      { 'if-match': etagOf(created) },
    );
    expect(edited.statusCode).toBe(200);
    const stale = await s.pm.browser.patch(
      `${s.base}/plan`,
      { summary: 'x' },
      { 'if-match': etagOf(created) },
    );
    expect(stale.statusCode).toBe(412);

    // The site team can read it but not set it up or approve it.
    expect((await s.site.browser.get(`${s.base}/plan`)).statusCode).toBe(200);
    expect(
      (
        await s.site.browser.patch(
          `${s.base}/plan`,
          { summary: 'x' },
          { 'if-match': etagOf(edited) },
        )
      ).statusCode,
    ).toBe(403);

    const approved = await s.pm.browser.post(
      `${s.base}/plan/approve`,
      {},
      { 'if-match': etagOf(edited) },
    );
    expect(approved.statusCode).toBe(200);
    const plan = approved.json();
    expect(plan.status).toBe('active');
    expect(plan.approvedAt).not.toBeNull();
    expect(plan.nextReviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Compliance conditions', () => {
  it('loads the starter pack once and numbers conditions per project', async () => {
    const s = await setup();
    const first = await s.pm.browser.post(`${s.base}/conditions/starter-pack`, {});
    expect(first.statusCode).toBe(201);
    const { created, skipped } = first.json();
    expect(created.length).toBeGreaterThanOrEqual(10);
    expect(skipped).toBe(0);
    expect(created[0].numberLabel).toBe('EMC-0001');
    const second = await s.pm.browser.post(`${s.base}/conditions/starter-pack`, {});
    expect(second.json().created).toEqual([]);
    expect(second.json().skipped).toBe(created.length);

    const list = await s.pm.browser.get(`${s.base}/conditions?category=air_quality`);
    expect(list.json().data.every((c: { category: string }) => c.category === 'air_quality')).toBe(
      true,
    );
  });

  it('signs off with evidence, keeps a trail, and rolls a recurring check forward', async () => {
    const s = await setup();
    const made = await s.pm.browser.post(`${s.base}/conditions`, {
      title: 'Inspect sediment basins',
      category: 'soil_erosion',
      source: 'cemp',
      frequency: 'weekly',
    });
    expect(made.statusCode).toBe(201);
    const id = made.json().condition.id;
    expect(made.json().condition).toMatchObject({ status: 'not_started', numberLabel: 'EMC-0001' });

    const url = `${s.base}/conditions/${id}`;
    const started = await s.site.browser.post(
      `${url}/transition`,
      { action: 'start' },
      { 'if-match': etagOf(made) },
    );
    expect(started.statusCode).toBe(200);
    expect(started.json().condition.status).toBe('in_progress');

    // The site team can't sign off; the accountable person can, but only with something to stand behind.
    expect(
      (
        await s.site.browser.post(
          `${url}/transition`,
          { action: 'signOff', note: 'done' },
          { 'if-match': etagOf(started) },
        )
      ).statusCode,
    ).toBe(403);
    const bare = await s.pm.browser.post(
      `${url}/transition`,
      { action: 'signOff' },
      { 'if-match': etagOf(started) },
    );
    expect(bare.statusCode).toBe(422);

    const evidence = await uploadFile(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      'basin.pdf',
      'environment',
    );
    const signed = await s.pm.browser.post(
      `${url}/transition`,
      { action: 'signOff', note: 'Basins clear, freeboard fine.', fileIds: [evidence] },
      { 'if-match': etagOf(started) },
    );
    expect(signed.statusCode).toBe(200);
    const body = signed.json();
    expect(body.condition).toMatchObject({ status: 'compliant', fileIds: [evidence] });
    expect(body.condition.lastReviewedOn).not.toBeNull();
    expect(body.condition.dueDate).not.toBeNull();
    expect(body.events.map((e: { action: string }) => e.action)).toEqual(['start', 'sign_off']);

    // A recurring check can be signed off again when it falls due.
    expect(body.condition.availableActions).toContain('signOff');
  });

  it('flags a breach with a reason, and a one-off cannot be signed off twice', async () => {
    const s = await setup();
    const made = await s.pm.browser.post(`${s.base}/conditions`, {
      title: 'Spill kit on site',
      category: 'hazardous_materials',
    });
    const id = made.json().condition.id;
    const url = `${s.base}/conditions/${id}/transition`;
    const noReason = await s.site.browser.post(
      url,
      { action: 'flagNonCompliant' },
      { 'if-match': etagOf(made) },
    );
    expect(noReason.statusCode).toBe(422);
    const flagged = await s.site.browser.post(
      url,
      { action: 'flagNonCompliant', note: 'Kit missing at the fuel store.' },
      { 'if-match': etagOf(made) },
    );
    expect(flagged.statusCode).toBe(200);
    expect(flagged.json().condition.status).toBe('non_compliant');

    const signed = await s.pm.browser.post(
      url,
      { action: 'signOff', note: 'Kit replaced and restocked.' },
      { 'if-match': etagOf(flagged) },
    );
    expect(signed.json().condition.status).toBe('compliant');
    const again = await s.pm.browser.post(
      url,
      { action: 'signOff', note: 'x' },
      { 'if-match': etagOf(signed) },
    );
    expect(again.statusCode).toBe(409);
  });

  it('lets a subcontractor read the register but not change it', async () => {
    const s = await setup();
    await s.pm.browser.post(`${s.base}/conditions`, { title: 'Dust', category: 'air_quality' });
    expect((await s.sub.browser.get(`${s.base}/conditions`)).statusCode).toBe(200);
    const denied = await s.sub.browser.post(`${s.base}/conditions`, {
      title: 'Nope',
      category: 'other',
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('Documents and the summary', () => {
  it('registers a document with an expiry state and raises Nova flags over the register', async () => {
    const s = await setup();
    const fileId = await uploadFile(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      'licence.pdf',
      'environment',
    );
    const doc = await s.pm.browser.post(`${s.base}/documents`, {
      title: 'EPA licence',
      docType: 'epa_licence',
      reference: 'EPA-1234',
      fileId,
      expiresOn: '2020-01-01',
    });
    expect(doc.statusCode).toBe(201);
    expect(doc.json().expiry).toBe('expired');

    const renewed = await s.pm.browser.patch(
      `${s.base}/documents/${doc.json().id}`,
      { expiresOn: '2099-01-01' },
      { 'if-match': etagOf(doc) },
    );
    expect(renewed.json().expiry).toBe('valid');

    await s.pm.browser.post(`${s.base}/conditions`, {
      title: 'Overdue sign-off',
      category: 'waste',
      dueDate: '2020-01-01',
    });
    const summary = (await s.pm.browser.get(`${s.base}/summary`)).json();
    expect(summary.conditions).toMatchObject({ total: 1, overdue: 1 });
    expect(summary.documents).toMatchObject({ total: 1, expired: 0 });
    const codes = summary.flags.map((f: { code: string }) => f.code);
    expect(codes).toContain('conditions_overdue');
    expect(codes).toContain('plan_missing');

    expect((await s.pm.browser.del(`${s.base}/documents/${doc.json().id}`)).statusCode).toBe(204);
    expect((await s.pm.browser.get(`${s.base}/documents`)).json().data).toEqual([]);
  });

  it('rejects a document file from another project', async () => {
    const s = await setup();
    const other = await createProject(s.pm.browser, s.org.id, { name: 'Other', state: 'VIC' });
    const fileId = await uploadFile(t, s.pm.browser, s.org.id, other.id, 'x.pdf', 'environment');
    const res = await s.pm.browser.post(`${s.base}/documents`, {
      title: 'Stray',
      docType: 'other',
      fileId,
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('Monitoring', () => {
  it('judges readings against limits, flags the linked condition on a breach, and answers it with an incident', async () => {
    const s = await setup();
    const cond = await s.pm.browser.post(`${s.base}/conditions`, {
      title: 'Dust suppression',
      category: 'air_quality',
    });
    const condition = cond.json().condition;
    const point = await s.pm.browser.post(`${s.base}/monitoring-points`, {
      name: 'North boundary dust',
      parameter: 'dust_pm10',
      unit: 'µg/m³',
      location: 'North boundary',
      maxLimit: 50,
      conditionId: condition.id,
    });
    expect(point.statusCode).toBe(201);
    const p = point.json();
    expect(p).toMatchObject({ maxLimit: 50, minLimit: null, latest: null, openBreaches: 0 });

    // Limits need at least one end, and a minimum below the maximum.
    const bad = await s.pm.browser.post(`${s.base}/monitoring-points`, {
      name: 'Nothing',
      parameter: 'other',
      unit: 'x',
    });
    expect(bad.statusCode).toBe(422);

    const url = `${s.base}/monitoring-points/${p.id}/readings`;
    expect((await s.site.browser.post(url, { value: 20 })).json().status).toBe('ok');
    expect((await s.site.browser.post(url, { value: 44 })).json().status).toBe('warning');
    const breach = await s.site.browser.post(url, { value: 61, note: 'Wind gusting' });
    expect(breach.statusCode).toBe(201);
    expect(breach.json()).toMatchObject({ status: 'breach', value: 61 });

    // The condition was flagged non-compliant automatically, with a trail row.
    const after = await s.pm.browser.get(`${s.base}/conditions/${condition.id}`);
    expect(after.json().condition.status).toBe('non_compliant');
    expect(after.json().events.at(-1).note).toContain('North boundary dust');

    const points = (await s.pm.browser.get(`${s.base}/monitoring-points`)).json().data;
    expect(points[0]).toMatchObject({ openBreaches: 1 });
    expect(points[0].latest.value).toBe(61);
    const summary = (await s.pm.browser.get(`${s.base}/summary`)).json();
    expect(summary.monitoring).toMatchObject({ points: 1, openBreaches: 1 });
    expect(summary.flags.map((f: { code: string }) => f.code)).toContain('monitoring_breach_open');

    // A subcontractor can read but not log or answer.
    expect((await s.sub.browser.get(`${s.base}/monitoring-points`)).statusCode).toBe(200);
    expect((await s.sub.browser.post(url, { value: 1 })).statusCode).toBe(403);

    // A breach needs a response; the site team answers it and raises an environmental incident.
    const respondUrl = `${s.base}/readings/${breach.json().id}/respond`;
    expect((await s.site.browser.post(respondUrl, { note: '' })).statusCode).toBe(422);
    const answered = await s.site.browser.post(respondUrl, {
      note: 'Water cart run every two hours; works paused until wind drops.',
      raiseIncident: true,
    });
    expect(answered.statusCode).toBe(200);
    const body = answered.json();
    expect(body.incidentId).toMatch(/^inx_/);
    expect(body.reading.respondedAt).not.toBeNull();
    const incident = await s.pm.browser.get(
      `/v1/orgs/${s.org.id}/projects/${s.project.id}/incidents/${body.incidentId}`,
    );
    expect(incident.json().incident).toMatchObject({ type: 'environmental' });

    // Answered once, and an ok reading has nothing to answer.
    expect((await s.site.browser.post(respondUrl, { note: 'again' })).statusCode).toBe(409);
    const open = await s.pm.browser.get(`${s.base}/readings?status=breach&open=true`);
    expect(open.json().data).toEqual([]);
  });

  it('keeps readings of a point newest first and refuses a future reading', async () => {
    const s = await setup();
    const point = (
      await s.pm.browser.post(`${s.base}/monitoring-points`, {
        name: 'Discharge pH',
        parameter: 'water_ph',
        unit: 'pH',
        minLimit: 6.5,
        maxLimit: 8.5,
      })
    ).json();
    const url = `${s.base}/monitoring-points/${point.id}/readings`;
    await s.pm.browser.post(url, { value: 7, takenAt: '2026-10-01T01:00:00Z' });
    await s.pm.browser.post(url, { value: 6.4, takenAt: '2026-10-02T01:00:00Z' });
    const list = (await s.pm.browser.get(url)).json();
    expect(list.data.map((r: { value: number }) => r.value)).toEqual([6.4, 7]);
    expect(list.data[0].status).toBe('breach');
    const future = await s.pm.browser.post(url, { value: 7, takenAt: '2099-01-01T00:00:00Z' });
    expect(future.statusCode).toBe(422);
  });
});

describe('Waste and carbon', () => {
  const today = () => new Date().toISOString().slice(0, 10);

  it('measures diversion from landfill and flags a low rate and a missing hazardous docket', async () => {
    const s = await setup();
    const docket = (body: Record<string, unknown>) =>
      s.site.browser.post(`${s.base}/waste`, { docketDate: today(), ...body });
    expect(
      (await docket({ wasteType: 'concrete', destination: 'recycled', tonnes: 80 })).statusCode,
    ).toBe(201);
    expect(
      (await docket({ wasteType: 'general', destination: 'landfill', tonnes: 20 })).statusCode,
    ).toBe(201);
    let summary = (await s.pm.browser.get(`${s.base}/waste/summary`)).json();
    expect(summary).toMatchObject({
      totalTonnes: 100,
      divertedTonnes: 80,
      diversionPercent: 80,
      targetPercent: 80,
      regulatedWithoutDocket: 0,
    });
    expect(summary.byDestination).toMatchObject({ recycled: 80, landfill: 20 });
    let flags = (await s.pm.browser.get(`${s.base}/summary`))
      .json()
      .flags.map((f: { code: string }) => f.code);
    expect(flags).not.toContain('waste_diversion_low');

    const asbestos = await docket({ wasteType: 'asbestos', destination: 'treatment', tonnes: 5 });
    expect(asbestos.statusCode).toBe(201);
    summary = (await s.pm.browser.get(`${s.base}/waste/summary`)).json();
    expect(summary.diversionPercent).toBe(76);
    expect(summary.regulatedWithoutDocket).toBe(1);
    const all = (await s.pm.browser.get(`${s.base}/summary`)).json();
    flags = all.flags.map((f: { code: string }) => f.code);
    expect(flags).toEqual(expect.arrayContaining(['waste_diversion_low', 'waste_docket_missing']));
    expect(all.waste).toMatchObject({ totalTonnes: 105, diversionPercent: 76 });

    // A docket entered by mistake can be removed, by someone allowed to.
    const id = asbestos.json().id;
    expect((await s.site.browser.del(`${s.base}/waste/${id}`)).statusCode).toBe(403);
    expect((await s.pm.browser.del(`${s.base}/waste/${id}`)).statusCode).toBe(204);
    expect((await s.pm.browser.del(`${s.base}/waste/${id}`)).statusCode).toBe(404);
    expect((await s.pm.browser.get(`${s.base}/waste/summary`)).json().regulatedWithoutDocket).toBe(
      0,
    );
  });

  it('refuses a docket dated in the future and lists newest first', async () => {
    const s = await setup();
    const url = `${s.base}/waste`;
    const future = await s.site.browser.post(url, {
      docketDate: '2099-01-01',
      wasteType: 'timber',
      destination: 'recycled',
      tonnes: 2,
    });
    expect(future.statusCode).toBe(422);
    await s.site.browser.post(url, {
      docketDate: '2026-10-01',
      wasteType: 'timber',
      destination: 'recycled',
      tonnes: 2,
    });
    await s.site.browser.post(url, {
      docketDate: '2026-10-05',
      wasteType: 'glass',
      destination: 'recycled',
      tonnes: 1,
    });
    const list = (await s.pm.browser.get(url)).json();
    expect(list.data.map((d: { docketDate: string }) => d.docketDate)).toEqual([
      '2026-10-05',
      '2026-10-01',
    ]);
    const onlyGlass = (await s.pm.browser.get(`${url}?wasteType=glass`)).json();
    expect(onlyGlass.data).toHaveLength(1);
  });

  it('converts activity to kg CO2-e with the default or an overridden factor', async () => {
    const s = await setup();
    const url = `${s.base}/carbon`;
    const diesel = await s.site.browser.post(url, {
      entryDate: today(),
      source: 'diesel_litres',
      quantity: 1000,
    });
    expect(diesel.statusCode).toBe(201);
    expect(diesel.json()).toMatchObject({ scope: 1, factor: 2.7, kgCo2e: 2700 });
    const power = await s.site.browser.post(url, {
      entryDate: today(),
      source: 'electricity_kwh',
      quantity: 5000,
      factor: 0.5,
    });
    expect(power.json()).toMatchObject({ scope: 2, factor: 0.5, kgCo2e: 2500 });
    const summary = (await s.pm.browser.get(`${s.base}/carbon/summary`)).json();
    expect(summary.totalKg).toBe(5200);
    expect(summary.byScope).toMatchObject({ '1': 2700, '2': 2500, '3': 0 });
    expect(summary.bySource[0]).toMatchObject({ source: 'diesel_litres', kg: 2700 });
    expect(summary.monthly).toHaveLength(6);
    expect((await s.pm.browser.get(`${s.base}/summary`)).json().carbon.totalKg).toBe(5200);

    const future = await s.site.browser.post(url, {
      entryDate: '2099-01-01',
      source: 'diesel_litres',
      quantity: 1,
    });
    expect(future.statusCode).toBe(422);
    expect((await s.site.browser.del(`${url}/${diesel.json().id}`)).statusCode).toBe(403);
    expect((await s.pm.browser.del(`${url}/${diesel.json().id}`)).statusCode).toBe(204);
    expect((await s.pm.browser.get(`${s.base}/carbon/summary`)).json().totalKg).toBe(2500);
  });
});
