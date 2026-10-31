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

async function setup(state: 'NSW' | 'QLD' = 'NSW') {
  const pm = await signUp(t.app, `fin-pm-${state}`);
  const sub = await signUp(t.app, `fin-sub-${state}`);
  const org = await createOrg(pm.browser, 'Finance Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower F', state });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Sparky',
  );
  return { pm, sub, base, subCo };
}

const contractBody = (payeeCompanyId?: string) => ({
  kind: 'subcontract',
  title: 'Electrical',
  ...(payeeCompanyId ? { payeeCompanyId } : {}),
  originalValue: '100000.00',
  retentionPct: '5.00',
  sov: [
    { code: 'E1', description: 'Rough-in', value: '60000.00' },
    { code: 'E2', description: 'Fit-off', value: '40000.00' },
  ],
});

describe('Contracts and payment claims (product/09)', () => {
  it('sets up a contract, takes a claim with stored deadlines, and issues a schedule', async () => {
    const s = await setup('NSW');
    const created = await s.pm.browser.post(`${s.base}/contracts`, contractBody(s.subCo.companyId));
    expect(created.statusCode).toBe(201);
    const { contract, sov } = created.json();
    expect(contract).toMatchObject({ number: 1, sopaState: 'NSW', originalValue: '100000.00' });
    expect(sov).toHaveLength(2);

    // Wed 14 Oct 2026 10:00 Sydney (UTC+11): schedule due Wed 28 Oct, pay Wed 11 Nov (compliance/02 N2).
    const claim = await s.pm.browser.post(`${s.base}/contracts/${contract.id}/claims`, {
      periodEnd: '2026-09-30',
      receivedAt: '2026-10-13T23:00:00Z',
      statesAct: true,
      lines: [{ sovItemId: sov[0].id, thisClaim: '30000.00' }],
    });
    expect(claim.statusCode).toBe(201);
    const c = claim.json().claim;
    expect(c).toMatchObject({
      number: 1,
      isValid: true,
      claimedGross: '30000.00',
      retention: '1500.00',
      claimedNet: '28500.00',
      gst: '2850.00',
      claimedTotal: '31350.00',
      servedOn: '2026-10-14',
      scheduleDueOn: '2026-10-28',
      paymentDueOn: '2026-11-11',
      rulesReviewed: false,
      status: 'submitted',
    });

    // A second claim sees what the first took.
    const second = await s.pm.browser.post(`${s.base}/contracts/${contract.id}/claims`, {
      periodEnd: '2026-10-31',
      receivedAt: '2026-11-12T00:00:00Z',
      statesAct: true,
      lines: [{ sovItemId: sov[0].id, thisClaim: '10000.00' }],
    });
    expect(second.json().lines[0]).toMatchObject({ previous: '30000.00', toDate: '40000.00' });
    const over = await s.pm.browser.post(`${s.base}/contracts/${contract.id}/claims`, {
      periodEnd: '2026-11-30',
      receivedAt: '2026-12-01T00:00:00Z',
      statesAct: true,
      lines: [{ sovItemId: sov[0].id, thisClaim: '25000.00' }],
    });
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe('financials.claim.over_item_value');

    const register = await s.pm.browser.get(`${s.base}/payment-claims`);
    expect(register.json().data.map((x: { number: number }) => x.number)).toEqual([1, 2]);

    // Less than claimed needs a reason.
    const bare = await s.pm.browser.post(`${s.base}/payment-claims/${c.id}/schedule`, {
      scheduledAmount: '20000.00',
    });
    expect(bare.statusCode).toBe(422);
    expect(bare.json().code).toBe('financials.schedule.reason_required');
    const tooMuch = await s.pm.browser.post(`${s.base}/payment-claims/${c.id}/schedule`, {
      scheduledAmount: '29000.00',
      overallReason: 'x',
    });
    expect(tooMuch.json().code).toBe('financials.schedule.over_claim');

    const issued = await s.pm.browser.post(`${s.base}/payment-claims/${c.id}/schedule`, {
      scheduledAmount: '24000.00',
      overallReason: 'Rough-in is 80% complete on the site diary, not 100%.',
      lineReasons: [{ sovItemId: sov[0].id, reason: 'Level 2 conduits not installed.' }],
    });
    expect(issued.statusCode).toBe(201);
    expect(issued.json().claim.status).toBe('scheduled');
    expect(issued.json().schedule).toMatchObject({
      scheduledAmount: '24000.00',
      withheldAmount: '4500.00',
    });
    const again = await s.pm.browser.post(`${s.base}/payment-claims/${c.id}/schedule`, {
      scheduledAmount: '24000.00',
      overallReason: 'again',
    });
    expect(again.json().code).toBe('financials.claim.already_scheduled');
  });

  it('flags an NSW claim with no Act statement and starts no deadlines', async () => {
    const s = await setup('NSW');
    const { contract, sov } = (
      await s.pm.browser.post(`${s.base}/contracts`, contractBody())
    ).json();
    const res = await s.pm.browser.post(`${s.base}/contracts/${contract.id}/claims`, {
      periodEnd: '2026-09-30',
      receivedAt: '2026-10-13T23:00:00Z',
      statesAct: false,
      lines: [{ sovItemId: sov[0].id, thisClaim: '1000.00' }],
    });
    expect(res.json().claim).toMatchObject({
      isValid: false,
      invalidReason: 'act_statement_missing',
      scheduleDueOn: null,
    });
    const issue = await s.pm.browser.post(
      `${s.base}/payment-claims/${res.json().claim.id}/schedule`,
      {
        scheduledAmount: '0.00',
        overallReason: 'Not a valid payment claim.',
      },
    );
    expect(issue.statusCode).toBe(409);
  });

  it('rejects a schedule of values that does not add up to the contract value', async () => {
    const s = await setup('QLD');
    const res = await s.pm.browser.post(`${s.base}/contracts`, {
      ...contractBody(),
      originalValue: '90000.00',
    });
    expect(res.statusCode).toBe(422);
  });

  it('shows a subcontractor only contracts where their company is the payee (CLM-AC11)', async () => {
    const s = await setup('QLD');
    const mine = (
      await s.pm.browser.post(`${s.base}/contracts`, contractBody(s.subCo.companyId))
    ).json();
    const theirs = (await s.pm.browser.post(`${s.base}/contracts`, contractBody())).json();
    const list = await s.sub.browser.get(`${s.base}/contracts`);
    expect(list.json().data.map((c: { id: string }) => c.id)).toEqual([mine.contract.id]);
    expect((await s.sub.browser.get(`${s.base}/contracts/${theirs.contract.id}`)).statusCode).toBe(
      404,
    );
    // Staff record the claim; the subcontractor sees it on their own contract but cannot record or assess.
    const claim = await s.pm.browser.post(`${s.base}/contracts/${mine.contract.id}/claims`, {
      periodEnd: '2026-09-30',
      receivedAt: '2026-10-01T00:00:00Z',
      statesAct: false,
      lines: [{ sovItemId: mine.sov[0].id, thisClaim: '1000.00' }],
    });
    expect(claim.statusCode).toBe(201);
    const register = await s.sub.browser.get(`${s.base}/payment-claims`);
    expect(register.json().data).toHaveLength(1);
    expect(
      (
        await s.sub.browser.post(`${s.base}/contracts/${mine.contract.id}/claims`, {
          periodEnd: '2026-09-30',
          receivedAt: '2026-10-01T00:00:00Z',
          statesAct: false,
          lines: [{ sovItemId: mine.sov[0].id, thisClaim: '1.00' }],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.sub.browser.post(`${s.base}/payment-claims/${claim.json().claim.id}/schedule`, {
          scheduledAmount: '1000.00',
        })
      ).statusCode,
    ).toBe(403);
  });
});
