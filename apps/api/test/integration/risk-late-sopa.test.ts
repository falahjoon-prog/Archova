import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

// Nova project risk, late SOPA payment schedules: the signals are read through the real financials, scheduling and
// workforce modules, each as the caller. Without a wallet grant the insurance is "not visible", never "fine".
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Risk = {
  unreadableProjects: number;
  projects: Array<{
    projectName: string;
    level: string;
    scheduleSlip: boolean;
    insuranceProblem: boolean;
    unknown: string[];
    slip: { lateCount: number; worst: Array<{ name: string; daysLate: number }> };
    claims: Array<{
      subbieName: string | null;
      insurance: string;
      deadline: string;
      summary: string;
    }>;
  }>;
};

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('GET /risk/late-sopa-claims', () => {
  it('lists a project whose claim schedule is near due, with programme slip and an unreadable insurance', async () => {
    const pm = await signUp(t.app, 'risk-pm');
    const sub = await signUp(t.app, 'risk-sub');
    const org = await createOrg(pm.browser, 'Risk Builder');
    const project = await createProject(pm.browser, org.id, { name: 'Risk Tower', state: 'NSW' });
    const quiet = await createProject(pm.browser, org.id, { name: 'Quiet Tower', state: 'NSW' });
    const subCo = await addMember(
      pm.browser,
      org.id,
      project.id,
      sub.email,
      'Subcontractor',
      'Sparky',
    );
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;

    const contract = (
      await pm.browser.post(`${base}/contracts`, {
        kind: 'subcontract',
        title: 'Electrical',
        payeeCompanyId: subCo.companyId,
        originalValue: '100000.00',
        retentionPct: '5.00',
        sov: [{ code: 'E1', description: 'Rough-in', value: '100000.00' }],
      })
    ).json();

    // Move the received date back until the stored schedule deadline falls inside the 5-day window.
    let dueOn = '';
    for (let back = 6; back <= 40 && !dueOn; back++) {
      const received = new Date(Date.now() - back * DAY).toISOString();
      const r = await pm.browser.post(`${base}/contracts/${contract.contract.id}/claims`, {
        periodEnd: iso(new Date(Date.now() - (back + 5) * DAY)),
        receivedAt: received,
        statesAct: true,
        lines: [{ sovItemId: contract.sov[0].id, thisClaim: '1000.00' }],
      });
      if (r.statusCode !== 201) continue;
      const due = r.json().claim.scheduleDueOn as string;
      const left = Math.round((Date.parse(due) - Date.now()) / DAY);
      if (left >= -3 && left <= 4) dueOn = due;
      else {
        // Withdraw is not needed: a later claim on the same contract is a separate row; keep looking.
      }
    }
    expect(dueOn).not.toBe('');

    // A programme with one task whose planned finish has passed and is not complete.
    const sched = await pm.browser.post(`${base}/schedules`, { name: 'Master programme' });
    const sid = sched.json().schedule.id as string;
    const act = await pm.browser.post(`${base}/schedules/${sid}/activities`, {
      name: 'Slab',
      start: '2020-03-01',
      finish: '2020-03-10',
    });
    expect(act.statusCode).toBe(201);

    const res = await pm.browser.get(`/v1/orgs/${org.id}/risk/late-sopa-claims`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Risk;
    const names = body.projects.map((p) => p.projectName);
    expect(names).toContain('Risk Tower');
    expect(names).not.toContain('Quiet Tower');
    const p = body.projects.find((x) => x.projectName === 'Risk Tower')!;
    expect(p.scheduleSlip).toBe(true);
    expect(p.slip.lateCount).toBe(1);
    expect(p.slip.worst[0]).toMatchObject({ name: 'Slab' });
    // No wallet grant: the insurance is not visible, which is reported, not treated as fine.
    expect(p.insuranceProblem).toBe(false);
    expect(p.claims.every((c) => c.insurance === 'not_visible')).toBe(true);
    expect(p.unknown).toContain('insurance');
    expect(p.level).toBe('medium');
    expect(p.claims[0]!.summary).toContain("can't be seen");
    void quiet;
  });

  it('is refused to a subcontractor, who holds no org-level reporting permission', async () => {
    const pm = await signUp(t.app, 'risk2-pm');
    const sub = await signUp(t.app, 'risk2-sub');
    const org = await createOrg(pm.browser, 'Risk Builder 2');
    const project = await createProject(pm.browser, org.id, { name: 'Risk Tower 2', state: 'NSW' });
    await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sparky');
    const res = await sub.browser.get(`/v1/orgs/${org.id}/risk/late-sopa-claims`);
    expect([401, 403, 404]).toContain(res.statusCode);
  });
});
