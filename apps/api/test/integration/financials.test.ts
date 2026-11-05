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

  it('keeps contracts, claims and variations for 10 years and refuses their deletion (compliance/07)', async () => {
    const s = await setup('NSW');
    const { contract, sov } = (
      await s.pm.browser.post(`${s.base}/contracts`, contractBody(s.subCo.companyId))
    ).json();
    const claim = await s.pm.browser.post(`${s.base}/contracts/${contract.id}/claims`, {
      periodEnd: '2026-09-30',
      receivedAt: '2026-10-13T23:00:00Z',
      statesAct: true,
      lines: [{ sovItemId: sov[0].id, thisClaim: '30000.00' }],
    });
    expect(claim.statusCode).toBe(201);
    const variation = await s.pm.browser.post(`${s.base}/contracts/${contract.id}/variations`, {
      title: 'Extra points',
      amount: '1200.00',
    });
    expect(variation.statusCode).toBe(201);
    const ctx: TenantContext = {
      orgId: decodeId('org', s.orgId)!,
      userId: '00000000-0000-0000-0000-000000000000',
      principalType: 'member',
      orgRole: null,
      entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
      requestId: 'test',
    };
    const tagged = await t.database.withTenantTx(ctx, (sc) =>
      sc.tx.execute(
        sql`select record_type, category, count(*)::int as n,
                   bool_and(retain_until > now() + interval '9 years 11 months') as ten_years
            from shared.retention_ledger where record_type like 'financials.%' group by 1, 2 order by 1`,
      ),
    );
    expect(tagged.rows.map((r) => [r.record_type, r.category, r.n, r.ten_years])).toEqual([
      ['financials.contracts', 'project_records_10y', 1, true],
      ['financials.payment_claim_lines', 'sopa_evidence_10y', 1, true],
      ['financials.payment_claims', 'sopa_evidence_10y', 1, true],
      ['financials.sov_items', 'project_records_10y', 2, true],
      ['financials.variations', 'sopa_evidence_10y', 1, true],
    ]);
    for (const table of [
      'payment_claim_lines',
      'payment_claims',
      'variations',
      'sov_items',
      'contracts',
    ])
      await expect(
        t.database.withTenantTx(ctx, (sc) =>
          sc.tx.execute(sql.raw(`delete from financials.${table}`)),
        ),
      ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/retention/) } });
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

  it("warns when an NSW subcontract claim has no subcontractor's statement and links one when recorded (compliance/05 §6)", async () => {
    const s = await setup('NSW');
    const { contract, sov } = (
      await s.pm.browser.post(`${s.base}/contracts`, contractBody(s.subCo.companyId))
    ).json();
    const claim = (
      await s.pm.browser.post(`${s.base}/contracts/${contract.id}/claims`, {
        periodEnd: '2026-09-30',
        receivedAt: '2026-10-13T23:00:00Z',
        statesAct: true,
        lines: [{ sovItemId: sov[0].id, thisClaim: '30000.00' }],
      })
    ).json();
    expect(claim).toMatchObject({ statement: null, warnings: ['subcontractor_statement_missing'] });
    const url = `${s.base}/payment-claims/${claim.claim.id}/subcontractor-statement`;

    // The warning never blocks: a schedule can be issued without a statement.
    const sched = await s.pm.browser.post(`${s.base}/payment-claims/${claim.claim.id}/schedule`, {
      scheduledAmount: '28500.00',
    });
    expect(sched.statusCode).toBe(201);
    expect(sched.json().warnings).toEqual(['subcontractor_statement_missing']);

    // Bad dates are refused; so is a subcontractor recording it for themselves.
    const body = { periodEnd: '2026-09-30', receivedOn: '2026-10-14', signedOn: '2026-10-13' };
    expect((await s.pm.browser.put(url, { ...body, receivedOn: '2999-01-01' })).statusCode).toBe(
      422,
    );
    expect((await s.pm.browser.put(url, { ...body, signedOn: '2026-10-15' })).statusCode).toBe(422);
    expect((await s.sub.browser.put(url, body)).statusCode).toBeGreaterThanOrEqual(403);

    const linked = await s.pm.browser.put(url, body);
    expect(linked.statusCode, linked.body).toBe(200);
    expect(linked.json()).toMatchObject({
      warnings: [],
      statement: { periodEnd: '2026-09-30', receivedOn: '2026-10-14', signedOn: '2026-10-13' },
    });
    // Recording again replaces it rather than adding a second.
    const again = await s.pm.browser.put(url, { ...body, note: 'Re-signed copy' });
    expect(again.json().statement.note).toBe('Re-signed copy');
    const read = await s.pm.browser.get(`${s.base}/payment-claims/${claim.claim.id}`);
    expect(read.json()).toMatchObject({ warnings: [], statement: { note: 'Re-signed copy' } });

    const ctx: TenantContext = {
      orgId: decodeId('org', s.orgId)!,
      userId: '00000000-0000-0000-0000-000000000000',
      principalType: 'member',
      orgRole: null,
      entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
      requestId: 'test',
    };
    const tagged = await t.database.withTenantTx(ctx, (sc) =>
      sc.tx.execute(
        sql`select category, count(*)::int as n from shared.retention_ledger
            where record_type = 'financials.claim_statements' group by 1`,
      ),
    );
    expect(tagged.rows.map((r) => [r.category, r.n])).toEqual([['financial_7y', 1]]);
    await expect(
      t.database.withTenantTx(ctx, (sc) =>
        sc.tx.execute(sql`delete from financials.claim_statements`),
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/retention/) } });
  });

  it('has no statement rule outside NSW or for a head contract', async () => {
    const q = await setup('QLD');
    const { contract, sov } = (
      await q.pm.browser.post(`${q.base}/contracts`, contractBody())
    ).json();
    const claim = (
      await q.pm.browser.post(`${q.base}/contracts/${contract.id}/claims`, {
        periodEnd: '2026-09-30',
        receivedAt: '2026-10-13T23:00:00Z',
        statesAct: true,
        lines: [{ sovItemId: sov[0].id, thisClaim: '1000.00' }],
      })
    ).json();
    expect(claim.warnings).toEqual([]);
    const res = await q.pm.browser.put(
      `${q.base}/payment-claims/${claim.claim.id}/subcontractor-statement`,
      { periodEnd: '2026-09-30', receivedOn: '2026-10-14' },
    );
    expect(res.statusCode).toBe(422);
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

describe('Subcontractor payments and retention trust (D5)', () => {
  it('shows the payee what is owed and paid, and records the trust account for staff only', async () => {
    const s = await setup('QLD');
    // $12M non-government QLD contract: over the $10M trust threshold.
    const made = await s.pm.browser.post(`${s.base}/contracts`, {
      kind: 'subcontract',
      title: 'Services package',
      payeeCompanyId: s.subCo.companyId,
      originalValue: '12000000.00',
      retentionPct: '5.00',
      sov: [{ code: 'S1', description: 'Services', value: '12000000.00' }],
    });
    expect(made.statusCode).toBe(201);
    const { contract, sov } = made.json();
    const other = (await s.pm.browser.post(`${s.base}/contracts`, contractBody())).json();
    const trustUrl = `${s.base}/contracts/${contract.id}/trust`;

    expect((await s.pm.browser.get(trustUrl)).json()).toMatchObject({
      requirement: { required: true, rulesReviewed: false },
      account: null,
      position: { status: 'not_set_up', balance: '0.00' },
    });

    const claim = await s.pm.browser.post(`${s.base}/contracts/${contract.id}/claims`, {
      periodEnd: '2026-09-30',
      receivedAt: '2026-10-01T00:00:00Z',
      statesAct: false,
      lines: [{ sovItemId: sov[0].id, thisClaim: '1000000.00' }],
    });
    expect(claim.json().claim.retention).toBe('50000.00');
    const claimId = claim.json().claim.id as string;
    await s.pm.browser.post(`${s.base}/payment-claims/${claimId}/schedule`, {
      scheduledAmount: '900000.00',
      overallReason: 'Services are 90% complete.',
    });

    // Staff say where the trust sits; the retention taken by the claim is not yet in it.
    const saved = await s.pm.browser.put(trustUrl, {
      institution: 'Example Bank',
      accountName: 'Services package retention trust',
      accountLast4: '4321',
      openedOn: '2026-10-01',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().position).toMatchObject({
      status: 'shortfall',
      retentionWithheld: '50000.00',
      shortfall: '50000.00',
    });
    expect((await s.pm.browser.put(trustUrl, { accountLast4: '12345' })).statusCode).toBe(422);

    const move = (body: Record<string, unknown>) =>
      s.pm.browser.post(`${trustUrl}/movements`, {
        movedOn: '2026-10-20',
        reference: 'TT-1',
        ...body,
      });
    const dep = await move({ kind: 'deposit', amount: '50000.00' });
    expect(dep.statusCode).toBe(201);
    expect(dep.json().position).toMatchObject({
      status: 'ok',
      balance: '50000.00',
      shortfall: '0.00',
    });
    const over = await move({ kind: 'release', amount: '60000.00' });
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe('financials.trust.insufficient');
    const rel = await move({ kind: 'release', amount: '20000.00', reference: 'TT-2' });
    expect(rel.json().position).toMatchObject({
      balance: '30000.00',
      released: '20000.00',
      requiredInTrust: '30000.00',
    });

    // An undo is a reversal of the release, and only once.
    const releaseId = rel.json().movements.find((m: { kind: string }) => m.kind === 'release').id;
    const undo = await move({
      kind: 'reversal',
      amount: '20000.00',
      reversesMovementId: releaseId,
    });
    expect(undo.json().position).toMatchObject({ balance: '50000.00', released: '0.00' });
    const twice = await move({
      kind: 'reversal',
      amount: '20000.00',
      reversesMovementId: releaseId,
    });
    expect(twice.json().code).toBe('financials.trust.already_reversed');

    // The payee sees the payment position and the trust, but cannot change either, or see another contract's.
    expect((await s.sub.browser.get(trustUrl)).json().position.balance).toBe('50000.00');
    expect((await s.sub.browser.put(trustUrl, { institution: 'Mine' })).statusCode).toBe(403);
    expect(
      (
        await s.sub.browser.post(`${trustUrl}/movements`, {
          kind: 'deposit',
          amount: '1.00',
          movedOn: '2026-10-20',
          reference: 'x',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await s.sub.browser.get(`${s.base}/contracts/${other.contract.id}/payment-summary`))
        .statusCode,
    ).toBe(404);
    expect(
      (await s.sub.browser.get(`${s.base}/contracts/${other.contract.id}/trust`)).statusCode,
    ).toBe(404);

    const before = await s.sub.browser.get(`${s.base}/contracts/${contract.id}/payment-summary`);
    expect(before.statusCode).toBe(200);
    // 900,000 scheduled plus 10% GST.
    expect(before.json()).toMatchObject({
      totalDue: '990000.00',
      totalPaid: '0.00',
      claims: [
        {
          number: 1,
          scheduledAmount: '900000.00',
          amountDue: '990000.00',
          paid: '0.00',
          outstanding: '990000.00',
        },
      ],
      trust: { position: { status: 'ok' } },
    });

    // A payment pulled from the accounting system moves the position.
    const ctx: TenantContext = {
      orgId: decodeId('org', s.orgId)!,
      userId: '00000000-0000-0000-0000-000000000000',
      principalType: 'member',
      orgRole: null,
      entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
      requestId: 'test',
    };
    const bill = await t.database.withTenantTx(ctx, (sc) =>
      t.modules.financials.api.ledgerSource(sc, decodeId('paymentClaim', claimId)!),
    );
    await t.database.withTenantTx(ctx, (sc) =>
      t.modules.financials.api.recordPayment(sc, {
        localType: 'payment_schedule',
        localId: bill!.localId,
        paidOn: '2026-11-03',
        amountCents: 40_000_000,
        source: 'xero',
        externalRef: 'pay-t1',
        reference: 'PC-1-1',
      }),
    );
    const after = await s.sub.browser.get(`${s.base}/contracts/${contract.id}/payment-summary`);
    expect(after.json()).toMatchObject({
      totalPaid: '400000.00',
      claims: [{ paid: '400000.00', lastPaidOn: '2026-11-03', outstanding: '590000.00' }],
    });
  });
});

describe('Budget and cost codes', () => {
  it('builds a draft, locks it, then only changes by adjustment with a reason', async () => {
    const s = await setup('NSW');
    const post = (path: string, body?: unknown) => s.pm.browser.post(`${s.base}${path}`, body);

    expect((await s.pm.browser.get(`${s.base}/budget`)).json()).toMatchObject({
      id: null,
      status: 'draft',
      lines: [],
    });
    const c1 = (await post('/cost-codes', { code: '03-100', description: 'Concrete' })).json();
    const c2 = (await post('/cost-codes', { code: '09-200', description: 'Painting' })).json();
    expect((await post('/cost-codes', { code: '03-100', description: 'Again' })).statusCode).toBe(
      409,
    );

    expect((await post('/budget/lines', { costCodeId: c1.id, original: '1.00' })).statusCode).toBe(
      404,
    );
    expect((await post('/budget')).statusCode).toBe(201);
    expect((await post('/budget')).statusCode).toBe(409);

    const l1 = (await post('/budget/lines', { costCodeId: c1.id, original: '50000.00' })).json();
    expect((await post('/budget/lines', { costCodeId: c1.id, original: '1.00' })).statusCode).toBe(
      409,
    );
    const l2 = (
      await post('/budget/lines', {
        costCodeId: c2.id,
        original: '8000.50',
        description: 'Internal',
      })
    ).json();
    const edited = await s.pm.browser.patch(`${s.base}/budget/lines/${l2.id}`, {
      original: '9000.00',
    });
    expect(edited.json()).toMatchObject({ original: '9000.00', revised: '9000.00' });

    // Not locked yet: no adjustments.
    expect(
      (await post(`/budget/lines/${l1.id}/adjustments`, { amount: '10.00', reason: 'x' }))
        .statusCode,
    ).toBe(409);

    const locked = (await post('/budget/lock')).json();
    expect(locked).toMatchObject({
      status: 'locked',
      totals: { original: '59000.00', revised: '59000.00' },
    });

    // Frozen: no draft edits, adds or deletes.
    expect(
      (await s.pm.browser.patch(`${s.base}/budget/lines/${l1.id}`, { original: '1.00' }))
        .statusCode,
    ).toBe(409);
    expect((await s.pm.browser.del(`${s.base}/budget/lines/${l1.id}`)).statusCode).toBe(409);
    expect((await post('/budget/lock')).statusCode).toBe(409);

    const up = await post(`/budget/lines/${l1.id}/adjustments`, {
      amount: '2500.75',
      reason: 'Extra slab',
    });
    expect(up.statusCode).toBe(201);
    expect(up.json()).toMatchObject({
      original: '50000.00',
      approvedChanges: '2500.75',
      revised: '52500.75',
    });
    const down = await post(`/budget/lines/${l1.id}/adjustments`, {
      amount: '-500.00',
      reason: 'Scope cut',
    });
    expect(down.json()).toMatchObject({ approvedChanges: '2000.75', revised: '52000.75' });
    expect(
      (await post(`/budget/lines/${l1.id}/adjustments`, { amount: '-60000.00', reason: 'Too far' }))
        .statusCode,
    ).toBe(422);
    expect(
      (await post(`/budget/lines/${l1.id}/adjustments`, { amount: '0', reason: 'Nothing' }))
        .statusCode,
    ).toBe(422);
    expect(
      (await post(`/budget/lines/${l1.id}/adjustments`, { amount: '5', reason: '   ' })).statusCode,
    ).toBe(422);

    const history = (await s.pm.browser.get(`${s.base}/budget/lines/${l1.id}/adjustments`)).json();
    expect(history.data.map((a: { amount: string }) => a.amount)).toEqual(['2500.75', '-500.00']);

    const after = (await s.pm.browser.get(`${s.base}/budget`)).json();
    expect(after.totals).toMatchObject({
      original: '59000.00',
      approvedChanges: '2000.75',
      revised: '61000.75',
    });
  });

  it('keeps the budget away from a subcontractor', async () => {
    const s = await setup('QLD');
    await s.pm.browser.post(`${s.base}/budget`);
    expect((await s.sub.browser.get(`${s.base}/budget`)).statusCode).toBe(403);
    expect(
      (await s.sub.browser.post(`${s.base}/cost-codes`, { code: 'X', description: 'x' }))
        .statusCode,
    ).toBe(403);
  });
});

describe('Cost forecast', () => {
  it('projects cost to complete from contracts, claims and adjustments, for staff only', async () => {
    const s = await setup('NSW');
    const head = await s.pm.browser.post(`${s.base}/contracts`, {
      kind: 'head',
      title: 'Head contract',
      originalValue: '500000.00',
      sov: [{ code: 'H1', description: 'All works', value: '500000.00' }],
    });
    expect(head.statusCode).toBe(201);
    const created = await s.pm.browser.post(`${s.base}/contracts`, contractBody(s.subCo.companyId));
    const { contract, sov } = created.json();
    const claim = await s.pm.browser.post(`${s.base}/contracts/${contract.id}/claims`, {
      periodEnd: '2026-09-30',
      receivedAt: '2026-10-13T23:00:00Z',
      statesAct: true,
      lines: [{ sovItemId: sov[0].id, thisClaim: '30000.00' }],
    });
    expect(claim.statusCode).toBe(201);

    const adj = await s.pm.browser.post(`${s.base}/cost-forecast/adjustments`, {
      category: 'unawarded_work',
      label: 'Landscaping not yet awarded',
      amount: '25000.00',
    });
    expect(adj.statusCode).toBe(201);
    const bad = await s.pm.browser.post(`${s.base}/cost-forecast/adjustments`, {
      category: 'risk',
      label: 'Zero',
      amount: '0.00',
    });
    expect(bad.statusCode).toBe(422);

    const f = await s.pm.browser.get(`${s.base}/cost-forecast`);
    expect(f.statusCode).toBe(200);
    expect(f.json()).toMatchObject({
      revenue: '500000.00',
      committed: '100000.00',
      claimedToDate: '30000.00',
      costToComplete: '70000.00',
      projectAdjustments: '25000.00',
      forecastFinalCost: '125000.00',
      forecastMargin: '375000.00',
      forecastMarginPct: '75.00',
    });
    expect(f.json().commitments).toHaveLength(1);

    // The subcontractor never sees the builder's margin.
    expect((await s.sub.browser.get(`${s.base}/cost-forecast`)).statusCode).toBe(403);

    const del = await s.pm.browser.del(`${s.base}/cost-forecast/adjustments/${adj.json().id}`);
    expect(del.statusCode).toBe(204);
    expect((await s.pm.browser.get(`${s.base}/cost-forecast`)).json().forecastFinalCost).toBe(
      '100000.00',
    );
  });
});

describe('Commitments against the budget', () => {
  it('counts only approved commitments as committed cost and guards the budget', async () => {
    const s = await setup('NSW');
    const post = (path: string, body?: unknown) => s.pm.browser.post(`${s.base}/${path}`, body);
    const c1 = (await post('cost-codes', { code: '03', description: 'Electrical' })).json();
    const c2 = (await post('cost-codes', { code: '05', description: 'Plumbing' })).json();
    expect((await post('budget')).statusCode).toBe(201);
    const e = (await post('budget/lines', { costCodeId: c1.id, original: '50000.00' })).json();
    const p = (await post('budget/lines', { costCodeId: c2.id, original: '20000.00' })).json();
    const committedOf = async (id: string) =>
      (await s.pm.browser.get(`${s.base}/budget`))
        .json()
        .lines.find((l: { id: string }) => l.id === id).committed;

    const draft = await post('commitments', {
      kind: 'subcontract',
      title: 'Electrical subcontract',
      vendorCompanyId: s.subCo.companyId,
      lines: [
        { budgetLineId: e.id, description: 'Rough-in', amount: '30000.00' },
        { budgetLineId: e.id, description: 'Fit-off', amount: '15000.00' },
      ],
    });
    expect(draft.statusCode).toBe(201);
    const c = draft.json();
    expect(c.commitment).toMatchObject({ number: 1, status: 'draft', total: '45000.00' });

    // Drafts are not committed cost, and can't be approved before submission.
    expect(await committedOf(e.id)).toBe('0.00');
    expect((await post(`commitments/${c.commitment.id}/approve`, {})).json().code).toBe(
      'financials.commitment.bad_state',
    );

    expect((await post(`commitments/${c.commitment.id}/submit`)).statusCode).toBe(200);
    expect((await post(`commitments/${c.commitment.id}/approve`, {})).statusCode).toBe(200);
    expect(await committedOf(e.id)).toBe('45000.00');

    // A second commitment that would pass the budget is refused unless overridden with a reason.
    const po = (
      await post('commitments', {
        kind: 'purchase_order',
        title: 'Switchboard',
        lines: [{ budgetLineId: e.id, description: 'Board', amount: '8000.00' }],
      })
    ).json();
    await post(`commitments/${po.commitment.id}/submit`);
    const over = await post(`commitments/${po.commitment.id}/approve`, {});
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe('financials.commitment.over_budget');
    expect(
      (await post(`commitments/${po.commitment.id}/approve`, { allowOverBudget: true })).json()
        .code,
    ).toBe('financials.commitment.reason_required');
    const ok = await post(`commitments/${po.commitment.id}/approve`, {
      allowOverBudget: true,
      note: 'Client-approved upgrade',
    });
    expect(ok.json().commitment).toMatchObject({ status: 'approved', overBudgetOverride: true });
    expect(await committedOf(e.id)).toBe('53000.00');

    // Rejection needs a reason and commits nothing; voiding an approved commitment releases its cost.
    const rej = (
      await post('commitments', {
        kind: 'purchase_order',
        title: 'Taps',
        lines: [{ budgetLineId: p.id, description: 'Taps', amount: '500.00' }],
      })
    ).json();
    await post(`commitments/${rej.commitment.id}/submit`);
    expect((await post(`commitments/${rej.commitment.id}/reject`, {})).json().code).toBe(
      'financials.commitment.reason_required',
    );
    expect(
      (await post(`commitments/${rej.commitment.id}/reject`, { note: 'Too dear' })).statusCode,
    ).toBe(200);
    expect(await committedOf(p.id)).toBe('0.00');
    expect(
      (await post(`commitments/${po.commitment.id}/void`, { note: 'Cancelled' })).statusCode,
    ).toBe(200);
    expect(await committedOf(e.id)).toBe('45000.00');

    const list = (await s.pm.browser.get(`${s.base}/commitments`)).json().data;
    expect(list.map((x: { number: number }) => x.number)).toEqual([3, 2, 1]);

    // A line that is not on this project's budget, and a subcontractor, are both refused.
    const bad = await post('commitments', {
      kind: 'purchase_order',
      title: 'x',
      lines: [{ budgetLineId: 'bln_00000000000000000000000000', description: 'x', amount: '1.00' }],
    });
    expect(bad.statusCode).toBe(404);
    expect((await s.sub.browser.get(`${s.base}/commitments`)).statusCode).toBe(403);
  });
});

describe('Budget against forecast', () => {
  it('compares revised budget with forecast final cost per cost code', async () => {
    const s = await setup('NSW');
    const post = (path: string, body?: unknown) => s.pm.browser.post(`${s.base}${path}`, body);
    const cc = (await post('/cost-codes', { code: '16-100', description: 'Electrical' })).json();
    await post('/budget');
    await post('/budget/lines', { costCodeId: cc.id, original: '50000.00' });
    await post('/budget/lock');

    const bad = await post('/contracts', {
      ...contractBody(s.subCo.companyId),
      sov: [
        {
          code: 'E1',
          description: 'x',
          value: '100000.00',
          costCodeId: 'ccd_0000000000000000000000000A',
        },
      ],
    });
    expect(bad.statusCode).toBe(404);

    const created = await post('/contracts', {
      ...contractBody(s.subCo.companyId),
      sov: [
        { code: 'E1', description: 'Rough-in', value: '60000.00', costCodeId: cc.id },
        { code: 'E2', description: 'Fit-off', value: '40000.00' },
      ],
    });
    expect(created.statusCode).toBe(201);
    const { contract, sov } = created.json();
    expect(sov[0].costCodeId).toBe(cc.id);
    expect(
      (
        await post(`/contracts/${contract.id}/claims`, {
          periodEnd: '2026-09-30',
          receivedAt: '2026-10-13T23:00:00Z',
          statesAct: true,
          lines: [{ sovItemId: sov[0].id, thisClaim: '30000.00' }],
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await post('/cost-forecast/adjustments', {
          category: 'risk',
          label: 'Switchboard',
          amount: '5000.00',
          costCodeId: cc.id,
        })
      ).statusCode,
    ).toBe(201);

    const r = (await s.pm.browser.get(`${s.base}/budget/vs-forecast`)).json();
    expect(r.budgetStatus).toBe('locked');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      code: '16-100',
      revised: '50000.00',
      committed: '60000.00',
      claimed: '30000.00',
      adjustments: '5000.00',
      forecastFinal: '65000.00',
      variance: '-15000.00',
    });
    expect(r.unallocated).toMatchObject({ committed: '40000.00', forecastFinal: '40000.00' });
    expect(r.totals).toMatchObject({ forecastFinal: '105000.00', variance: '-55000.00' });

    // Reconciles with the project forecast.
    const f = (await s.pm.browser.get(`${s.base}/cost-forecast`)).json();
    expect(f.forecastFinalCost).toBe(r.totals.forecastFinal);

    expect((await s.sub.browser.get(`${s.base}/budget/vs-forecast`)).statusCode).toBe(403);
  });
});
