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

async function setup() {
  const pm = await signUp(t.app, 'op-pm');
  const client = await signUp(t.app, 'op-client');
  const sub = await signUp(t.app, 'op-sub');
  const org = await createOrg(pm.browser, 'Portal Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower P', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}/owner-portal`;
  await addMember(pm.browser, org.id, project.id, client.email, 'Client', 'Harbour Developments');
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sparky');
  return { pm, client, sub, base };
}

const update = {
  title: 'October progress',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  summary: 'Slab poured on level 2.',
  percentComplete: 35,
  milestones: [{ name: 'Level 2 slab', date: '2026-10-20', status: 'done' }],
};
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

describe('owner portal', () => {
  it('shows the client only published progress updates, and freezes them once published', async () => {
    const { pm, client, base } = await setup();
    const draft = (await pm.browser.post(`${base}/progress-updates`, update)).json() as {
      id: string;
      version: number;
      status: string;
    };
    expect(draft.status).toBe('draft');

    const before = await client.browser.get(`${base}/progress-updates`);
    expect(before.statusCode).toBe(200);
    expect(before.json().data).toEqual([]);
    expect((await pm.browser.get(`${base}/progress-updates`)).json().data).toHaveLength(1);

    // The client cannot write.
    expect((await client.browser.post(`${base}/progress-updates`, update)).statusCode).toBe(403);

    const edited = await pm.browser.patch(
      `${base}/progress-updates/${draft.id}`,
      { percentComplete: 40 },
      ifMatch(draft.version),
    );
    expect(edited.statusCode).toBe(200);

    const published = await pm.browser.post(`${base}/progress-updates/${draft.id}/publish`);
    expect(published.statusCode).toBe(200);
    expect(published.json().status).toBe('published');
    expect(published.json().percentComplete).toBe(40);

    const seen = (await client.browser.get(`${base}/progress-updates`)).json().data;
    expect(seen).toHaveLength(1);
    expect(seen[0].title).toBe('October progress');

    const again = await pm.browser.patch(
      `${base}/progress-updates/${draft.id}`,
      { percentComplete: 50 },
      ifMatch(published.json().version),
    );
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ownerportal.update_published');
  });

  it('lets the client decide a request once, and never the person who asked', async () => {
    const { pm, client, sub, base } = await setup();
    const req = (
      await pm.browser.post(`${base}/approvals`, {
        title: 'Lobby stone upgrade',
        amountCents: 4_500_000,
        dueDate: '2026-11-20',
      })
    ).json() as { id: string; number: number; status: string };
    expect(req).toMatchObject({ number: 1, status: 'requested' });

    // Neither the builder (asked for it) nor a subcontractor (no portal access) can decide.
    expect(
      (await pm.browser.post(`${base}/approvals/${req.id}/decision`, { decision: 'approved' }))
        .statusCode,
    ).toBe(403);
    expect((await sub.browser.get(`${base}/approvals`)).statusCode).toBe(403);

    const decided = await client.browser.post(`${base}/approvals/${req.id}/decision`, {
      decision: 'approved',
      note: 'Go ahead.',
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ status: 'approved', decisionNote: 'Go ahead.' });
    expect(decided.json().decidedAt).toBeTruthy();

    const twice = await client.browser.post(`${base}/approvals/${req.id}/decision`, {
      decision: 'rejected',
    });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().code).toBe('ownerportal.approval_decided');
    expect((await pm.browser.post(`${base}/approvals/${req.id}/withdraw`)).statusCode).toBe(409);

    const second = (await pm.browser.post(`${base}/approvals`, { title: 'Extra car bays' })).json();
    expect(second.number).toBe(2);
    expect((await pm.browser.post(`${base}/approvals/${second.id}/withdraw`)).json().status).toBe(
      'withdrawn',
    );
  });

  it('keeps a capital plan with totals per year and overall', async () => {
    const { pm, client, base } = await setup();
    const line = (fiscalYear: number, budgetCents: number) => ({
      fiscalYear,
      category: 'Construction',
      budgetCents,
      forecastCents: budgetCents + 100,
      spentCents: 50,
    });
    const a = (await pm.browser.post(`${base}/capital-plan`, line(2027, 1000))).json();
    await pm.browser.post(`${base}/capital-plan`, line(2027, 500));
    await pm.browser.post(`${base}/capital-plan`, line(2028, 200));

    const plan = (await client.browser.get(`${base}/capital-plan`)).json();
    expect(plan.items).toHaveLength(3);
    expect(plan.totals).toEqual([
      { fiscalYear: 2027, budgetCents: 1500, forecastCents: 1700, spentCents: 100 },
      { fiscalYear: 2028, budgetCents: 200, forecastCents: 300, spentCents: 50 },
      { fiscalYear: null, budgetCents: 1700, forecastCents: 2000, spentCents: 150 },
    ]);
    expect((await client.browser.post(`${base}/capital-plan`, line(2027, 1))).statusCode).toBe(403);

    const changed = await pm.browser.patch(
      `${base}/capital-plan/${a.id}`,
      { spentCents: 900 },
      ifMatch(a.version),
    );
    expect(changed.json().spentCents).toBe(900);
    expect((await pm.browser.del(`${base}/capital-plan/${a.id}`)).statusCode).toBe(204);
    expect((await client.browser.get(`${base}/capital-plan`)).json().items).toHaveLength(2);
  });
});
