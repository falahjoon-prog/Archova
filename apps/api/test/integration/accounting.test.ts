import { sql } from 'drizzle-orm';
import { decodeId } from '@archova/domain';
import type { TenantContext } from '@archova/kernel';
import type { accounting } from '@archova/mod-integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createTestContext, signUp, type TestContext } from './helpers';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

// What Xero answers, keyed by the calls the connector makes.
const calls: { url: string; method: string }[] = [];
let invoiceStatus: string | null = null;
let failTokens = false;
let tenants = [
  { tenantId: 'ten-1', tenantName: 'Harbour Builders Pty Ltd', tenantType: 'ORGANISATION' },
];
const fakeFetch = async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  calls.push({ url, method });
  if (url.includes('identity.xero.com/connect/token'))
    return failTokens
      ? json({ error: 'invalid_grant' }, 400)
      : json({ access_token: 'at', refresh_token: 'rt', expires_in: 1800 });
  if (url.endsWith('/connections')) return json(tenants);
  if (url.includes('/Invoices') && method === 'GET')
    return json({
      Invoices: invoiceStatus
        ? [{ InvoiceID: 'inv-1', Status: invoiceStatus, UpdatedDateUTC: 'v1' }]
        : [],
    });
  if (url.includes('/Invoices') && method === 'POST')
    return json({ Invoices: [{ InvoiceID: 'inv-1', Status: 'DRAFT', UpdatedDateUTC: 'v2' }] });
  if (url.includes('/Payments'))
    return json({
      Payments: [
        {
          PaymentID: 'pay-1',
          Date: '2026-10-20',
          Amount: 1100,
          Status: 'AUTHORISED',
          Invoice: { Reference: 'PC-SC1-1' },
        },
      ],
    });
  return json({}, 404);
};

const jobContext = (orgId: string): TenantContext => ({
  orgId,
  userId: '00000000-0000-0000-0000-000000000000',
  principalType: 'member',
  orgRole: null,
  entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
  requestId: 'test',
});

const doc: accounting.LedgerDocument = {
  kind: 'bill',
  reference: 'PC-SC1-1',
  contactRemoteId: 'contact-1',
  date: '2026-10-14',
  dueDate: '2026-10-28',
  lines: [{ description: 'Slab', costCode: '03.100', amountCents: 100_000, gstCents: 10_000 }],
  retentionCents: 5_000,
  status: 'draft',
};

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext({
    accountingFetch: fakeFetch,
    env: { API_XERO_CLIENT_ID: 'xid', API_XERO_CLIENT_SECRET: 'xsecret' },
  });
});
afterAll(() => t.close());

async function setup(label: string) {
  const owner = await signUp(t.app, label);
  const org = await createOrg(owner.browser, 'Ledger Builders');
  return { owner, org, base: `/v1/orgs/${org.id}/accounting` };
}
async function connectXero(s: Awaited<ReturnType<typeof setup>>) {
  const start = (await s.owner.browser.post(`${s.base}/connections/xero/connect`)).json();
  const state = new URL(start.url).searchParams.get('state')!;
  return s.owner.browser.post(`${s.base}/connections/xero/callback`, { code: 'code-1', state });
}
const run = <T>(orgId: string, fn: Parameters<typeof t.database.withTenantTx<T>>[1]) =>
  t.database.withTenantTx(jobContext(orgId), fn);
const svc = () => t.modules.integrations.api.accounting;

describe('Xero and MYOB connections (integrations/02)', () => {
  it('offers only providers that have app credentials, and refuses the others', async () => {
    const s = await setup('acc-avail');
    const list = (await s.owner.browser.get(`${s.base}/connections`)).json();
    expect(list).toEqual({ data: [], available: ['xero'] });
    const res = await s.owner.browser.post(`${s.base}/connections/myob/connect`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'accounting.not_configured' });
  });

  it('signs in with PKCE, picks the only organisation and seals the tokens', async () => {
    const s = await setup('acc-connect');
    const start = (await s.owner.browser.post(`${s.base}/connections/xero/connect`)).json();
    const url = new URL(start.url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_id')).toBe('xid');

    const bad = await s.owner.browser.post(`${s.base}/connections/xero/callback`, {
      code: 'c',
      state: 'wrong',
    });
    expect(bad.statusCode).toBe(422);

    const res = await connectXero(s);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      provider: 'xero',
      status: 'active',
      targetName: 'Harbour Builders Pty Ltd',
    });
    // The state is single use.
    const again = await s.owner.browser.post(`${s.base}/connections/xero/callback`, {
      code: 'c',
      state: url.searchParams.get('state'),
    });
    expect(again.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).not.toMatch(/refresh|access/i);
  });

  it('waits for a choice when the account reaches several organisations', async () => {
    const s = await setup('acc-several');
    tenants = [
      { tenantId: 'a', tenantName: 'Alpha', tenantType: 'ORGANISATION' },
      { tenantId: 'b', tenantName: 'Beta', tenantType: 'ORGANISATION' },
    ];
    try {
      const res = await connectXero(s);
      expect(res.json()).toMatchObject({ status: 'needs_target', targetName: null });
      const listed = (await s.owner.browser.get(`${s.base}/connections/xero/targets`)).json();
      expect(listed.data.map((x: { name: string }) => x.name)).toEqual(['Alpha', 'Beta']);
      // A ref the sign-in cannot reach is refused, so it never reaches a provider URL.
      const bad = await s.owner.browser.put(`${s.base}/connections/xero/targets`, {
        ref: '../..',
        name: 'Beta',
      });
      expect(bad.statusCode).toBe(422);
      expect(bad.json()).toMatchObject({ code: 'accounting.invalid_target' });
      // The stored name is the provider's, not the one the client sent.
      const picked = await s.owner.browser.put(`${s.base}/connections/xero/targets`, {
        ref: 'b',
        name: 'Anything',
      });
      expect(picked.json()).toMatchObject({ status: 'active', targetName: 'Beta' });
    } finally {
      tenants = [
        { tenantId: 'ten-1', tenantName: 'Harbour Builders Pty Ltd', tenantType: 'ORGANISATION' },
      ];
    }
  });

  it('expires the sign-in link after 10 minutes and spends it on a failed exchange', async () => {
    const s = await setup('acc-ttl');
    const orgId = decodeId('org', s.org.id)!;
    const begin = async () => {
      const start = (await s.owner.browser.post(`${s.base}/connections/xero/connect`)).json();
      return new URL(start.url).searchParams.get('state')!;
    };
    const post = (state: string) =>
      s.owner.browser.post(`${s.base}/connections/xero/callback`, { code: 'c', state });

    const old = await begin();
    await run(orgId, (sc) =>
      sc.tx.execute(
        sql`update integrations.accounting_connections set oauth_state_at = now() - interval '11 minutes'`,
      ),
    );
    expect((await post(old)).statusCode).toBe(422);

    // A refused code ends the attempt: the same link cannot be tried again.
    const fresh = await begin();
    failTokens = true;
    try {
      expect((await post(fresh)).statusCode).toBe(502);
    } finally {
      failTokens = false;
    }
    expect((await post(fresh)).statusCode).toBe(422);
  });

  it('keeps connections to org admins', async () => {
    const s = await setup('acc-perm');
    const other = await signUp(t.app, 'acc-outsider');
    const res = await other.browser.get(`${s.base}/connections`);
    expect([403, 404]).toContain(res.statusCode);
  });

  it('pushes a draft bill, raises issues for gaps, and leaves an approved bill alone', async () => {
    const s = await setup('acc-push');
    await connectXero(s);
    const orgId = decodeId('org', s.org.id)!;
    const push = (d = doc) =>
      run(orgId, (sc) =>
        svc().push(sc, 'xero', { localType: 'payment_schedule', localId: LOCAL_ID, document: d }),
      );

    // No retention account yet: nothing is sent and an issue explains why.
    expect(await push()).toBe('issue');
    await s.owner.browser.put(`${s.base}/connections/xero/field-map`, {
      accounts: {},
      retention: { accountRef: '820', taxRef: 'NONE' },
    });
    expect(await push()).toBe('issue');
    const issues = (await s.owner.browser.get(`${s.base}/sync-issues`)).json().data;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'unmapped_cost_code',
      provider: 'xero',
      reference: 'PC-SC1-1',
    });

    await s.owner.browser.put(`${s.base}/connections/xero/field-map`, {
      accounts: { '03.100': { accountRef: '300', taxRef: 'INPUT2' } },
      retention: { accountRef: '820', taxRef: 'NONE' },
    });
    invoiceStatus = null;
    expect(await push()).toBe('created');
    invoiceStatus = 'DRAFT';
    expect(await push()).toBe('updated');
    invoiceStatus = 'AUTHORISED';
    expect(await push()).toBe('locked');
    expect(
      (await s.owner.browser.get(`${s.base}/sync-issues`))
        .json()
        .data.map((i: { kind: string }) => i.kind),
    ).toContain('remote_locked');

    const resolved = await s.owner.browser.post(`${s.base}/sync-issues/${issues[0].id}/resolve`);
    expect(resolved.json()).toMatchObject({ status: 'resolved' });
  });

  it('skips documents before the start date or when a flow is off', async () => {
    const s = await setup('acc-skip');
    await connectXero(s);
    const orgId = decodeId('org', s.org.id)!;
    await s.owner.browser.put(`${s.base}/connections/xero/settings`, {
      startDate: '2026-11-01',
      pushBills: true,
      pushInvoices: false,
      billStatus: 'draft',
    });
    const push = (d: accounting.LedgerDocument) =>
      run(orgId, (sc) =>
        svc().push(sc, 'xero', { localType: 'claim', localId: LOCAL_ID, document: d }),
      );
    expect(await push(doc)).toBe('skipped');
    expect(await push({ ...doc, kind: 'invoice', date: '2026-12-01' })).toBe('skipped');
  });

  it('pulls each payment once', async () => {
    const s = await setup('acc-pull');
    await connectXero(s);
    const orgId = decodeId('org', s.org.id)!;
    const first = await run(orgId, (sc) => svc().pullPayments(sc, 'xero'));
    expect(first).toEqual([
      {
        remoteId: 'pay-1',
        documentReference: 'PC-SC1-1',
        paidOn: '2026-10-20',
        amountCents: 110_000,
      },
    ]);
    expect(await run(orgId, (sc) => svc().pullPayments(sc, 'xero'))).toEqual([]);
  });

  it('disconnects and forgets the links', async () => {
    const s = await setup('acc-disc');
    await connectXero(s);
    expect((await s.owner.browser.del(`${s.base}/connections/xero`)).statusCode).toBe(204);
    expect((await s.owner.browser.get(`${s.base}/connections`)).json().data).toEqual([]);
  });
});

const LOCAL_ID = '018f0000-0000-7000-8000-000000000001';
