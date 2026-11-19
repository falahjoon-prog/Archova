import { sql } from 'drizzle-orm';
import { decodeId, uuidv7 } from '@archova/domain';
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

/** Makes a project member an organisation member too: builder staff, not a guest company. */
async function makeStaff(orgId: string, owner: { userId: string }, who: { userId: string }) {
  await t.adminDb.withTenantTx(
    {
      orgId: decodeId('org', orgId)!,
      userId: decodeId('user', owner.userId)!,
      principalType: 'member' as const,
      orgRole: 'owner' as const,
      entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
      requestId: 'test',
    },
    ({ tx }) =>
      tx.execute(sql`insert into platform.memberships (id, org_id, user_id, role, status, joined_at)
                     values (${uuidv7()}, ${decodeId('org', orgId)!}, ${decodeId('user', who.userId)!}, 'member', 'active', now())`),
  );
}

async function setup() {
  const pm = await signUp(t.app, 'wf-owner');
  const a1 = await signUp(t.app, 'wf-a1');
  const a2 = await signUp(t.app, 'wf-a2');
  const org = await createOrg(pm.browser, 'Workflow Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower W', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, a1.email, 'Project Manager', 'WF Builder');
  await addMember(pm.browser, org.id, project.id, a2.email, 'Project Manager', 'WF Builder');
  await makeStaff(org.id, pm, a1);
  await makeStaff(org.id, pm, a2);
  const contract = (
    await pm.browser.post(`${base}/contracts`, {
      kind: 'subcontract',
      title: 'Electrical',
      originalValue: '100000.00',
      sov: [{ code: 'E1', description: 'All', value: '100000.00' }],
    })
  ).json().contract;
  const draft = async (amount: string) => {
    const v = (
      await pm.browser.post(`${base}/contracts/${contract.id}/variations`, {
        title: 'Extra',
        amount,
      })
    ).json();
    return `${base}/variations/${v.id}`;
  };
  return { pm, a1, a2, org, base, draft };
}

describe('Approval workflows', () => {
  it('routes a variation through the configured steps and only the last approval approves it', async () => {
    const s = await setup();
    const wf = `/v1/orgs/${s.org.id}/workflows`;
    const made = await s.pm.browser.post(wf, {
      subjectType: 'financials.variation',
      name: 'Variations over $10k',
      minAmount: '10000.00',
      steps: [
        { name: 'Project manager', approverUserIds: [s.a1.userId] },
        { name: 'Director', approverUserIds: [s.a2.userId] },
      ],
    });
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json()).toMatchObject({ active: true, minAmount: '10000.00' });
    // Only one active chain per kind of record.
    const second = await s.pm.browser.post(wf, {
      subjectType: 'financials.variation',
      name: 'Other',
      steps: [{ name: 'Anyone', approverUserIds: [s.a1.userId] }],
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('workflow.active_exists');
    // One person cannot be the only approver of two steps.
    const clash = await s.pm.browser.post(wf, {
      subjectType: 'financials.variation',
      name: 'Clash',
      active: false,
      steps: [
        { name: 'One', approverUserIds: [s.a1.userId] },
        { name: 'Two', approverUserIds: [s.a1.userId] },
      ],
    });
    expect(clash.statusCode).toBe(422);
    // Members who are not org admins cannot configure workflows.
    expect((await s.a1.browser.get(wf)).statusCode).toBe(403);

    // Below the minimum, the usual single approval still applies.
    const small = await s.draft('5000.00');
    await s.pm.browser.post(`${small}/submit`, {});
    expect((await s.pm.browser.get(`${small}/workflow`)).json().run).toBeNull();
    expect((await s.pm.browser.post(`${small}/approve`, {})).json().status).toBe('approved');

    // Above it, the chain decides.
    const big = await s.draft('20000.00');
    expect((await s.pm.browser.post(`${big}/submit`, {})).json().status).toBe('submitted');
    const started = (await s.pm.browser.get(`${big}/workflow`)).json().run;
    expect(started).toMatchObject({ status: 'pending', currentStep: 0 });
    expect(started.steps.map((x: { state: string }) => x.state)).toEqual(['current', 'waiting']);

    const own = await s.pm.browser.post(`${big}/approve`, {});
    expect(own.statusCode).toBe(403);
    expect(own.json().code).toBe('workflow.own_submission');
    const early = await s.a2.browser.post(`${big}/approve`, {});
    expect(early.statusCode).toBe(403);
    expect(early.json().code).toBe('workflow.not_approver');

    const first = await s.a1.browser.post(`${big}/approve`, { note: 'Scope ok' });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('submitted'); // not approved yet
    const mid = (await s.pm.browser.get(`${big}/workflow`)).json().run;
    expect(mid.currentStep).toBe(1);
    expect(mid.steps.map((x: { state: string }) => x.state)).toEqual(['approved', 'current']);
    expect(mid.steps[0].decision.note).toBe('Scope ok');
    expect((await s.a1.browser.post(`${big}/approve`, {})).statusCode).toBe(403);

    const last = await s.a2.browser.post(`${big}/approve`, {});
    expect(last.json().status).toBe('approved');
    expect((await s.pm.browser.get(`${big}/workflow`)).json().run.status).toBe('approved');

    // A rejection at any step ends it, with the reason.
    const other = await s.draft('30000.00');
    await s.pm.browser.post(`${other}/submit`, {});
    expect((await s.a1.browser.post(`${other}/reject`, {})).statusCode).toBe(422);
    const rejected = await s.a1.browser.post(`${other}/reject`, { note: 'Not in scope' });
    expect(rejected.json()).toMatchObject({ status: 'rejected', decisionNote: 'Not in scope' });
    expect((await s.pm.browser.get(`${other}/workflow`)).json().run.status).toBe('rejected');

    // Withdrawing cancels the run.
    const gone = await s.draft('40000.00');
    await s.pm.browser.post(`${gone}/submit`, {});
    await s.pm.browser.post(`${gone}/withdraw`, {});
    expect((await s.pm.browser.get(`${gone}/workflow`)).json().run.status).toBe('cancelled');

    // Switching the chain off sends later submissions back to the single approver.
    const id = made.json().id;
    expect((await s.pm.browser.patch(`${wf}/${id}`, { active: false })).json().active).toBe(false);
    const after = await s.draft('50000.00');
    await s.pm.browser.post(`${after}/submit`, {});
    expect((await s.pm.browser.post(`${after}/approve`, {})).json().status).toBe('approved');
    expect((await s.pm.browser.del(`${wf}/${id}`)).statusCode).toBe(204);
    expect((await s.pm.browser.get(wf)).json().data).toHaveLength(0);
  });

  it("keeps one organisation from seeing or changing another one's workflows", async () => {
    const a = await setup();
    const b = await setup();
    const made = await a.pm.browser.post(`/v1/orgs/${a.org.id}/workflows`, {
      subjectType: 'financials.variation',
      name: 'Mine',
      steps: [{ name: 'PM', approverUserIds: [a.a1.userId] }],
    });
    const id = made.json().id;
    expect((await b.pm.browser.get(`/v1/orgs/${b.org.id}/workflows`)).json().data).toHaveLength(0);
    expect(
      (await b.pm.browser.patch(`/v1/orgs/${b.org.id}/workflows/${id}`, { active: false }))
        .statusCode,
    ).toBe(404);
    expect((await b.pm.browser.get(`/v1/orgs/${a.org.id}/workflows`)).statusCode).toBe(404);
  });
});
