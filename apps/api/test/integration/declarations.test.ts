import { decodeId } from '@archova/domain';
import { sql } from 'drizzle-orm';
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

async function setup(tag: string) {
  const pm = await signUp(t.app, `dec-pm-${tag}`);
  const sub = await signUp(t.app, `dec-sub-${tag}`);
  const org = await createOrg(pm.browser, 'Declarations Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower D', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subCo = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Sparky Electrical',
    [],
    `accounts-${tag}@sparky.example`,
  );
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
  const claim = (
    await pm.browser.post(`${base}/contracts/${contract.contract.id}/claims`, {
      periodEnd: '2026-09-30',
      receivedAt: '2026-10-13T23:00:00Z',
      statesAct: true,
      lines: [{ sovItemId: contract.sov[0].id, thisClaim: '30000.00' }],
    })
  ).json().claim;
  return {
    pm,
    sub,
    base,
    orgId: org.id,
    dec: `${base}/declarations`,
    companyId: subCo.companyId,
    claim,
  };
}

const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const body = (companyId: string, kind: string, extra: Record<string, unknown> = {}) => ({
  kind,
  companyId,
  validFrom: '2026-07-01',
  validTo: '2027-06-30',
  declarantName: 'Sam Sparks',
  declarantPosition: 'Director',
  ...extra,
});

describe('Subcontractor statutory declarations', () => {
  it('records, numbers and derives status, and keeps a history', async () => {
    const s = await setup('a');
    const a = await s.pm.browser.post(
      `${s.dec}/statements`,
      body(s.companyId, 'workers_comp', { issuer: 'icare', referenceNumber: 'WC-1' }),
    );
    expect(a.statusCode, a.body).toBe(201);
    expect(a.json().declaration).toMatchObject({
      numberLabel: 'DEC-0001',
      kind: 'workers_comp',
      lifecycle: 'accepted',
      companyId: s.companyId,
    });
    const b = await s.pm.browser.post(
      `${s.dec}/statements`,
      body(s.companyId, 'wages', { validFrom: '2025-01-01', validTo: '2025-01-31' }),
    );
    expect(b.json().declaration).toMatchObject({ numberLabel: 'DEC-0002', status: 'expired' });
    const expired = await s.pm.browser.get(`${s.dec}/statements?status=expired`);
    expect(expired.json().data.map((d: { numberLabel: string }) => d.numberLabel)).toEqual([
      'DEC-0002',
    ]);

    expect(
      (
        await s.pm.browser.post(
          `${s.dec}/statements`,
          body(s.companyId, 'wages', { validFrom: '2027-01-01', validTo: '2026-01-01' }),
        )
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await s.pm.browser.post(
          `${s.dec}/statements`,
          body('cmp_00000000000000000000000000', 'wages'),
        )
      ).statusCode,
    ).toBeGreaterThanOrEqual(404);

    const d = a.json().declaration;
    const noWhy = await s.pm.browser.post(
      `${s.dec}/statements/${d.id}/transition`,
      { action: 'reject' },
      ifMatch(d.version),
    );
    expect(noWhy.statusCode).toBe(422);
    const rejected = await s.pm.browser.post(
      `${s.dec}/statements/${d.id}/transition`,
      { action: 'reject', note: 'Unsigned' },
      ifMatch(d.version),
    );
    expect(rejected.json().declaration).toMatchObject({
      status: 'rejected',
      lifecycle: 'rejected',
    });
    const stale = await s.pm.browser.post(
      `${s.dec}/statements/${d.id}/transition`,
      { action: 'accept' },
      ifMatch(d.version),
    );
    expect(stale.statusCode).toBe(412);
    expect(rejected.json().events.map((e: { action: string }) => e.action)).toEqual([
      'add',
      'reject',
    ]);

    // A subcontractor can't keep the register.
    expect(
      (await s.sub.browser.post(`${s.dec}/statements`, body(s.companyId, 'payroll_tax')))
        .statusCode,
    ).toBeGreaterThanOrEqual(403);
  });

  it('shows open subcontract claims as blocked until the required declarations cover them', async () => {
    const s = await setup('b');
    const none = await s.pm.browser.get(`${s.dec}/claims`);
    expect(none.json()).toMatchObject({ requirementsSet: false });
    expect(none.json().data[0]).toMatchObject({
      state: 'cleared',
      number: 1,
      companyId: s.companyId,
    });

    const set = await s.pm.browser.put(`${s.dec}/requirements`, {
      items: [
        { kind: 'workers_comp', leadDays: 30 },
        { kind: 'payroll_tax', leadDays: 14 },
        { kind: 'wages', leadDays: 7 },
      ],
    });
    expect(set.json().data).toHaveLength(3);
    const blocked = (await s.pm.browser.get(`${s.dec}/claims`)).json().data[0];
    expect(blocked.state).toBe('blocked');
    expect(blocked.issues.map((i: { kind: string }) => i.kind)).toEqual([
      'missing',
      'missing',
      'missing',
    ]);

    // Dates must cover the claim's period end (30 Sep 2026).
    await s.pm.browser.post(`${s.dec}/statements`, body(s.companyId, 'workers_comp'));
    await s.pm.browser.post(
      `${s.dec}/statements`,
      body(s.companyId, 'payroll_tax', { validFrom: '2026-07-01', validTo: '2026-08-31' }),
    );
    const partly = (await s.pm.browser.get(`${s.dec}/claims`)).json().data[0];
    expect(
      partly.issues.map(
        (i: { kind: string; declarationKind: string }) => `${i.declarationKind}:${i.kind}`,
      ),
    ).toEqual(['payroll_tax:expired', 'wages:missing']);

    await s.pm.browser.post(
      `${s.dec}/statements`,
      body(s.companyId, 'payroll_tax', { validFrom: '2026-09-01', validTo: '2026-09-30' }),
    );
    await s.pm.browser.post(
      `${s.dec}/statements`,
      body(s.companyId, 'wages', {
        claimId: s.claim.id,
        validFrom: '2026-09-01',
        validTo: '2026-09-30',
      }),
    );
    const cleared = (await s.pm.browser.get(`${s.dec}/claims`)).json().data[0];
    expect(cleared).toMatchObject({ state: 'cleared', issues: [] });
  });

  it('asks for an acknowledgement to schedule money with a declaration missing, never refuses a $0 schedule, and records it', async () => {
    const s = await setup('c');
    await s.pm.browser.put(`${s.dec}/requirements`, {
      items: [{ kind: 'payroll_tax', leadDays: 14 }],
    });
    const url = `${s.base}/payment-claims/${s.claim.id}/schedule`;

    const refused = await s.pm.browser.post(url, { scheduledAmount: '28500.00' });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe('financials.schedule.declarations_missing');
    expect(refused.body).toContain('payroll tax');

    // Scheduling nothing is the builder's call and is not asked about.
    const probe = await s.pm.browser.post(url, {
      scheduledAmount: '0.00',
      overallReason: 'Assessed at nil.',
    });
    expect(probe.statusCode, probe.body).toBe(201);
  });

  it('goes ahead with an acknowledgement, and a subcontractor statement stands for all three', async () => {
    const s = await setup('d');
    await s.pm.browser.put(`${s.dec}/requirements`, {
      items: [
        { kind: 'workers_comp', leadDays: 30 },
        { kind: 'wages', leadDays: 7 },
      ],
    });
    const url = `${s.base}/payment-claims/${s.claim.id}/schedule`;
    const thin = await s.pm.browser.post(url, {
      scheduledAmount: '28500.00',
      declarationsOverride: { reason: '' },
    });
    expect(thin.statusCode).toBe(422);
    const ok = await s.pm.browser.post(url, {
      scheduledAmount: '28500.00',
      declarationsOverride: { reason: 'Sparky sent them by phone; the paper is on its way.' },
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().claim.status).toBe('scheduled');
    const claimUuid = decodeId('paymentClaim', s.claim.id);
    const { rows } = await t.adminDb.withTenantTx(
      {
        orgId: decodeId('org', s.orgId)!,
        userId: decodeId('user', s.pm.userId)!,
        principalType: 'member' as const,
        orgRole: 'owner' as const,
        entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
        requestId: 'test',
      },
      ({ tx }) =>
        tx.execute<{ reason: string; issues: string[] }>(
          sql`select reason, issues from declarations.overrides where claim_id = ${claimUuid}`,
        ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toContain('on its way');
    expect(rows[0]!.issues).toHaveLength(2);

    // A second claim with a recorded subcontractor's statement is not blocked.
    const s2 = await setup('e');
    await s2.pm.browser.put(`${s2.dec}/requirements`, {
      items: [{ kind: 'workers_comp', leadDays: 30 }],
    });
    const link = await s2.pm.browser.put(
      `${s2.base}/payment-claims/${s2.claim.id}/subcontractor-statement`,
      {
        periodEnd: '2026-09-30',
        receivedOn: '2026-10-14',
      },
    );
    expect(link.statusCode, link.body).toBe(200);
    expect((await s2.pm.browser.get(`${s2.dec}/claims`)).json().data[0]).toMatchObject({
      state: 'cleared',
      coveredByStatement: true,
    });
    const sched = await s2.pm.browser.post(`${s2.base}/payment-claims/${s2.claim.id}/schedule`, {
      scheduledAmount: '28500.00',
    });
    expect(sched.statusCode, sched.body).toBe(201);
  });

  it('drafts a chase without sending, then sends exactly what was shown and records it', async () => {
    const s = await setup('f');
    await s.pm.browser.put(`${s.dec}/requirements`, {
      items: [
        { kind: 'workers_comp', leadDays: 30 },
        { kind: 'wages', leadDays: 7 },
      ],
    });
    await s.pm.browser.post(`${s.dec}/statements`, body(s.companyId, 'workers_comp'));
    const before = t.messages.sent.length;
    const draft = await s.pm.browser.post(`${s.dec}/chases`, {
      companyId: s.companyId,
      claimId: s.claim.id,
    });
    expect(draft.statusCode, draft.body).toBe(200);
    expect(draft.json()).toMatchObject({ sent: false, recipient: 'accounts-f@sparky.example' });
    expect(draft.json().draft.kinds).toEqual(['wages']);
    expect(draft.json().draft.body).toContain('Wages and superannuation declaration');
    expect(t.messages.sent.length).toBe(before);

    const sent = await s.pm.browser.post(`${s.dec}/chases`, {
      companyId: s.companyId,
      claimId: s.claim.id,
      send: true,
      subject: 'Wages declaration please',
      body: 'Hi, can you send the wages declaration for claim 1?',
    });
    expect(sent.json()).toMatchObject({ sent: true });
    expect(t.messages.sent.at(-1)).toMatchObject({
      channel: 'email',
      to: 'accounts-f@sparky.example',
    });
    expect(t.messages.sent.at(-1)!.text).toContain('Wages declaration please');
    const log = await s.pm.browser.get(`${s.dec}/chases`);
    expect(log.json().data).toHaveLength(1);
    expect(log.json().data[0]).toMatchObject({
      subject: 'Wages declaration please',
      kinds: ['wages'],
    });

    // Once it is on the register there is nothing left to chase.
    await s.pm.browser.post(
      `${s.dec}/statements`,
      body(s.companyId, 'wages', { validFrom: '2026-09-01', validTo: '2026-09-30' }),
    );
    const none = await s.pm.browser.post(`${s.dec}/chases`, {
      companyId: s.companyId,
      claimId: s.claim.id,
      send: true,
    });
    expect(none.statusCode).toBe(422);
  });

  it('flags what needs attention for Nova, and cannot be read from another organisation', async () => {
    const s = await setup('g');
    await s.pm.browser.put(`${s.dec}/requirements`, {
      items: [
        { kind: 'workers_comp', leadDays: 30 },
        { kind: 'payroll_tax', leadDays: 14 },
      ],
    });
    await s.pm.browser.post(
      `${s.dec}/statements`,
      body(s.companyId, 'workers_comp', { validFrom: '2025-07-01', validTo: '2026-06-30' }),
    );
    const flags = (await s.pm.browser.get(`${s.dec}/flags`)).json().data;
    expect(
      flags.map((f: { kind: string; declarationKind: string }) => `${f.declarationKind}:${f.kind}`),
    ).toEqual(['workers_comp:expired', 'payroll_tax:missing']);
    expect(flags[0].severity).toBe('high');

    const outsider = await signUp(t.app, 'dec-out');
    const org2 = await createOrg(outsider.browser, 'Other Builder');
    const res = await outsider.browser.get(
      `/v1/orgs/${org2.id}/projects/${s.base.split('/').pop()}/declarations/statements`,
    );
    expect(res.statusCode).toBeGreaterThanOrEqual(403);
  });
});
