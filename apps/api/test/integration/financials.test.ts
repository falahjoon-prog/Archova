import { createHash } from 'node:crypto';
import { decodeId } from '@archova/domain';
import type { TenantContext } from '@archova/kernel';
import type { PaymentInput } from '@archova/mod-financials';
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
  return { pm, sub, base, subCo, orgId: org.id };
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
    // Sealed evidence: one record for the claim, one for the schedule, each re-hashes cleanly (compliance/01 §4).
    const evidence = await s.pm.browser.get(`${s.base}/payment-claims/${c.id}/evidence`);
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json().records).toMatchObject([
      { kind: 'claim', intact: true, snapshotSha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { kind: 'schedule', intact: true },
    ]);
    const pdf = await s.pm.browser.get(`${s.base}/payment-claims/${c.id}/evidence/schedule/pdf`);
    expect(pdf.statusCode).toBe(200);
    const bytes = Buffer.from(pdf.json().dataBase64, 'base64');
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      evidence.json().records[1].pdfSha256,
    );
    const json = await s.pm.browser.get(`${s.base}/payment-claims/${c.id}/evidence/schedule/json`);
    expect(createHash('sha256').update(json.json().dataText).digest('hex')).toBe(
      evidence.json().records[1].snapshotSha256,
    );
    // The schedule's record names the sealed claim it answers.
    expect(JSON.parse(json.json().dataText).claimEvidenceSha256).toBe(
      evidence.json().records[0].snapshotSha256,
    );
    // The sealed rows cannot be changed, even by the table owner's app role.
    const tamper: TenantContext = {
      orgId: decodeId('org', s.orgId)!,
      userId: '00000000-0000-0000-0000-000000000000',
      principalType: 'member',
      orgRole: null,
      entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
      requestId: 'test',
    };
    await expect(
      t.database.withTenantTx(tamper, (sc) =>
        sc.tx.execute(sql`update financials.evidence_records set snapshot_text = 'x'`),
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/sealed evidence/) } });
    const again = await s.pm.browser.post(`${s.base}/payment-claims/${c.id}/schedule`, {
      scheduledAmount: '24000.00',
      overallReason: 'again',
    });
    expect(again.json().code).toBe('financials.claim.already_scheduled');

    // What the accounting system is sent: the schedule as a bill, scaled to the 24,000 payable, retention held aside.
    const ctx: TenantContext = {
      orgId: decodeId('org', s.orgId)!,
      userId: '00000000-0000-0000-0000-000000000000',
      principalType: 'member',
      orgRole: null,
      entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
      requestId: 'test',
    };
    const source = (claimId: string) =>
      t.database.withTenantTx(ctx, (sc) =>
        t.modules.financials.api.ledgerSource(sc, decodeId('paymentClaim', claimId)!),
      );
    const bill = await source(c.id);
    expect(bill).toMatchObject({
      kind: 'bill',
      localType: 'payment_schedule',
      contractNumber: 1,
      claimNumber: 1,
      retentionCents: 150_000,
      counterparty: { name: expect.any(String) },
      lines: [{ code: 'E1', amountCents: 2_550_000, gstCents: 240_000 }],
    });
    // The second claim has no schedule yet, so there is no bill to send.
    expect(await source(second.json().claim.id)).toBeNull();

    // Payments pulled from the accounting system land on the claim once, and a reversal is a negative row (A7).
    const pay = (input: Partial<PaymentInput>) =>
      t.database.withTenantTx(ctx, (sc) =>
        t.modules.financials.api.recordPayment(sc, {
          localType: 'payment_schedule',
          localId: bill!.localId,
          paidOn: '2026-11-03',
          amountCents: 1_000_000,
          source: 'xero',
          externalRef: 'pay-1',
          reference: 'PC-1-1',
          ...input,
        }),
      );
    expect(await pay({})).toBe('recorded');
    expect(await pay({})).toBe('duplicate');
    expect(await pay({ localId: '018f0000-0000-7000-8000-0000000000aa' })).toBe('unknown');
    // A reversal of a payment we never recorded is ignored; of one we did, it is kept beside the original.
    expect(
      await pay({ externalRef: 'pay-9:reversed', amountCents: -5, reversesExternalRef: 'pay-9' }),
    ).toBe('unknown');
    expect(
      await pay({
        externalRef: 'pay-1:reversed',
        amountCents: -1_000_000,
        reversesExternalRef: 'pay-1',
      }),
    ).toBe('recorded');
    const rows = await t.database.withTenantTx(ctx, (sc) =>
      sc.tx.execute(
        sql`select amount::text as amount, reverses_payment_id is not null as reversal from financials.payments order by recorded_at, amount desc`,
      ),
    );
    expect(rows.rows.map((r) => [r.amount, r.reversal])).toEqual([
      ['10000.00', false],
      ['-10000.00', true],
    ]);
    await expect(
      t.database.withTenantTx(ctx, (sc) => sc.tx.execute(sql`delete from financials.payments`)),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
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
  it('takes a variation through approval and lets only an approved one be claimed (CLM-AC12/13)', async () => {
    const s = await setup('NSW');
    const { contract, sov } = (
      await s.pm.browser.post(`${s.base}/contracts`, contractBody(s.subCo.companyId))
    ).json();
    const v = `${s.base}/contracts/${contract.id}/variations`;
    const draft = await s.pm.browser.post(v, {
      title: 'Extra circuits',
      amount: '5000.00',
      timeImpactDays: 3,
    });
    expect(draft.statusCode).toBe(201);
    const variation = draft.json();
    expect(variation).toMatchObject({ number: 1, status: 'draft', claimedToDate: '0.00' });

    const claimBody = (thisClaim: string) => ({
      periodEnd: '2026-09-30',
      receivedAt: '2026-10-13T23:00:00Z',
      statesAct: true,
      lines: [{ variationId: variation.id, thisClaim }],
    });
    // Not yet approved: cannot be claimed.
    const early = await s.pm.browser.post(
      `${s.base}/contracts/${contract.id}/claims`,
      claimBody('1000.00'),
    );
    expect(early.statusCode).toBe(422);
    expect(early.json().code).toBe('financials.variation.not_approved');

    const one = `${s.base}/variations/${variation.id}`;
    expect((await s.pm.browser.post(`${one}/approve`, {})).statusCode).toBe(409); // still a draft
    expect((await s.pm.browser.post(`${one}/submit`, {})).json().status).toBe('submitted');
    expect((await s.pm.browser.post(`${one}/reject`, {})).statusCode).toBe(422); // reason needed
    const approved = await s.pm.browser.post(`${one}/approve`, { note: 'Agreed with client' });
    expect(approved.json()).toMatchObject({
      status: 'approved',
      decisionNote: 'Agreed with client',
    });
    expect((await s.pm.browser.post(`${one}/withdraw`, {})).statusCode).toBe(409);

    const list = (await s.pm.browser.get(v)).json();
    expect(list.approvedTotal).toBe('5000.00');

    const ok = await s.pm.browser.post(`${s.base}/contracts/${contract.id}/claims`, {
      ...claimBody('3000.00'),
      lines: [
        { variationId: variation.id, thisClaim: '3000.00' },
        { sovItemId: sov[0].id, thisClaim: '10000.00' },
      ],
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().claim.claimedGross).toBe('13000.00');
    expect(ok.json().lines.map((l: { variationId: string | null }) => l.variationId)).toContain(
      variation.id,
    );
    expect((await s.pm.browser.get(one)).json().claimedToDate).toBe('3000.00');

    // A variation line goes to the accounting system under cost code VAR-n, not dropped for lack of a schedule item.
    const scheduled = await s.pm.browser.post(
      `${s.base}/payment-claims/${ok.json().claim.id}/schedule`,
      { scheduledAmount: '12350.00' },
    );
    expect(scheduled.statusCode).toBe(201);
    const bill = await t.database.withTenantTx(
      {
        orgId: decodeId('org', s.orgId)!,
        userId: '00000000-0000-0000-0000-000000000000',
        principalType: 'member',
        orgRole: null,
        entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
        requestId: 'test',
      },
      (sc) =>
        t.modules.financials.api.ledgerSource(sc, decodeId('paymentClaim', ok.json().claim.id)!),
    );
    expect(bill?.lines.map((l) => l.code)).toEqual(['E1', 'VAR-1']);
    expect(bill?.lines.reduce((n, l) => n + l.amountCents, 0)).toBe(1_235_000 + 65_000);

    // Cannot take the variation past its amount.
    const over = await s.pm.browser.post(
      `${s.base}/contracts/${contract.id}/claims`,
      claimBody('2500.00'),
    );
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe('financials.claim.over_item_value');

    // A subcontractor can read variations put to them on their contract but not change them, and never sees drafts.
    expect((await s.sub.browser.get(v)).statusCode).toBe(200);
    const hidden = (
      await s.pm.browser.post(v, { title: 'Internal draft', amount: '10.00' })
    ).json();
    expect((await s.sub.browser.get(v)).json().data.map((x: { id: string }) => x.id)).not.toContain(
      hidden.id,
    );
    expect((await s.sub.browser.get(`${s.base}/variations/${hidden.id}`)).statusCode).toBe(404);
    expect((await s.sub.browser.get(`${s.base}/variations/${variation.id}`)).statusCode).toBe(200);
    expect(
      (await s.pm.browser.post(`${s.base}/variations/${hidden.id}/withdraw`, {})).statusCode,
    ).toBe(200);
    expect((await s.sub.browser.get(`${s.base}/variations/${hidden.id}`)).statusCode).toBe(404);
    expect((await s.sub.browser.post(v, { title: 'Sneaky', amount: '1.00' })).statusCode).toBe(403);
    expect((await s.sub.browser.post(`${one}/approve`, {})).statusCode).toBe(403);
  });
});
