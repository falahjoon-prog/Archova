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
