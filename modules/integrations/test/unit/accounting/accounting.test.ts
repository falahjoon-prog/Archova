import { describe, expect, it } from 'vitest';
import {
  RateLimiter,
  UnmappedCostCodeError,
  authorizeUrl,
  buildMyobDocument,
  buildXeroInvoice,
  centsToDecimal,
  createMyobProvider,
  createTokenSession,
  createTokenVault,
  createXeroProvider,
  newPkce,
  xeroDate,
  type FetchLike,
  type FieldMap,
  type LedgerDocument,
} from '../../../src/domain/accounting';

const target = { accountRef: '300', taxRef: 'INPUT2' };
const map: FieldMap = {
  accounts: { '03.100': target, '04.200': { ...target, accountRef: '310', trackingRef: 'job-1' } },
  retention: { accountRef: '820', taxRef: 'NONE' },
};
const doc: LedgerDocument = {
  kind: 'bill',
  reference: 'PC-SC12-3',
  contactRemoteId: 'c-1',
  date: '2026-10-14',
  dueDate: '2026-10-28',
  lines: [
    { description: 'Slab', costCode: '03.100', amountCents: 1_000_000, gstCents: 100_000 },
    { description: 'Formwork', costCode: '04.200', amountCents: 250_050, gstCents: 25_005 },
  ],
  retentionCents: 62_502,
  status: 'draft',
};
const noWait = new RateLimiter(1000, 5);
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers });

describe('money and lines', () => {
  it('formats cents without floats', () => {
    expect(centsToDecimal(5)).toBe('0.05');
    expect(centsToDecimal(-62_502)).toBe('-625.02');
  });
  it('lists every unmapped cost code at once', () => {
    const bad = {
      ...doc,
      lines: [
        { ...doc.lines[0]!, costCode: 'x' },
        { ...doc.lines[0]!, costCode: 'y' },
      ],
    };
    expect(() => buildXeroInvoice(bad, map)).toThrow(UnmappedCostCodeError);
    try {
      buildXeroInvoice(bad, map);
    } catch (e) {
      expect((e as UnmappedCostCodeError).costCodes).toEqual(['x', 'y']);
    }
  });
});

describe('xero', () => {
  it('builds a draft ACCPAY bill with retention as a negative line', () => {
    const inv = buildXeroInvoice(doc, map);
    expect(inv.Type).toBe('ACCPAY');
    expect(inv.Status).toBe('DRAFT');
    expect(inv.LineItems).toHaveLength(3);
    expect(inv.LineItems[2]).toMatchObject({ UnitAmount: '-625.02', AccountCode: '820' });
    expect(inv.LineItems[1]).toMatchObject({ Tracking: [{ TrackingOptionID: 'job-1' }] });
    expect(
      buildXeroInvoice({ ...doc, kind: 'invoice', status: 'awaiting_approval' }, map),
    ).toMatchObject({
      Type: 'ACCREC',
      Status: 'SUBMITTED',
    });
  });

  const session = { accessToken: async () => 'tok', tenantId: 'ten' };
  it('creates when the reference is new, sending the tenant header and an idempotency key', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return init?.method === 'POST'
        ? json({ Invoices: [{ InvoiceID: 'i-1', Status: 'DRAFT', UpdatedDateUTC: 'v1' }] })
        : json({ Invoices: [] });
    };
    const r = await createXeroProvider(session, f, noWait).push(doc, map);
    expect(r).toEqual({
      outcome: 'created',
      remoteId: 'i-1',
      remoteVersion: 'v1',
      remoteStatus: 'draft',
    });
    const post = calls[1]!.init!;
    expect((post.headers as Record<string, string>)['xero-tenant-id']).toBe('ten');
    expect((post.headers as Record<string, string>)['Idempotency-Key']).toBe('PC-SC12-3:new');
  });
  it('updates a draft in place and leaves an approved bill alone', async () => {
    const mk = (status: string) =>
      createXeroProvider(
        session,
        async (_u, init) =>
          init?.method === 'POST'
            ? json({ Invoices: [{ InvoiceID: 'i-1', Status: 'DRAFT' }] })
            : json({ Invoices: [{ InvoiceID: 'i-1', Status: status }] }),
        noWait,
      );
    expect((await mk('DRAFT').push(doc, map)).outcome).toBe('updated');
    expect(await mk('AUTHORISED').push(doc, map)).toMatchObject({
      outcome: 'locked',
      remoteStatus: 'authorised',
    });
  });
  it('marks 429 and 5xx retryable and others not', async () => {
    const p = (s: number) =>
      createXeroProvider(session, async () => json({}, s), noWait).push(doc, map);
    await expect(p(429)).rejects.toMatchObject({ retryable: true });
    await expect(p(400)).rejects.toMatchObject({ retryable: false });
  });
  it('reads only our payments and skips deleted ones', async () => {
    const f: FetchLike = async () =>
      json({
        Payments: [
          {
            PaymentID: 'p1',
            Date: '/Date(1697500800000+0000)/',
            Amount: 1250.5,
            Status: 'AUTHORISED',
            Invoice: { Reference: 'PC-SC12-3' },
          },
          {
            PaymentID: 'p2',
            Date: '2026-10-01',
            Amount: 5,
            Status: 'AUTHORISED',
            Invoice: { Reference: 'other' },
          },
          {
            PaymentID: 'p3',
            Date: '2026-10-01',
            Amount: 5,
            Status: 'DELETED',
            Invoice: { Reference: 'PC-X-1' },
          },
        ],
      });
    expect(await createXeroProvider(session, f, noWait).paymentsSince(new Date(0))).toEqual([
      {
        remoteId: 'p1',
        documentReference: 'PC-SC12-3',
        paidOn: '2023-10-17',
        amountCents: 125_050,
      },
    ]);
    expect(xeroDate('2026-10-01T00:00:00')).toBe('2026-10-01');
  });
});

describe('myob', () => {
  const session = {
    accessToken: async () => 'tok',
    apiKey: 'key',
    companyFileUrl: 'https://api.myob.com/accountright/cf',
  };
  it('builds a purchase bill and a sale invoice carrying the reference', () => {
    expect(buildMyobDocument(doc, map)).toMatchObject({
      Supplier: { UID: 'c-1' },
      SupplierInvoiceNumber: 'PC-SC12-3',
      IsTaxInclusive: false,
    });
    const inv = buildMyobDocument({ ...doc, kind: 'invoice' }, map) as {
      Lines: { Total: number }[];
    };
    expect(inv).toMatchObject({
      Customer: { UID: 'c-1' },
      CustomerPurchaseOrderNumber: 'PC-SC12-3',
    });
    expect(inv.Lines.at(-1)!.Total).toBe(-625.02);
  });
  it('creates from the Location header, with the API key headers', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return init?.method === 'POST'
        ? new Response(null, { status: 201, headers: { Location: 'https://x/Bill/Service/uid-9' } })
        : json({ Items: [] });
    };
    const r = await createMyobProvider(session, f, noWait).push(doc, map);
    expect(r).toMatchObject({ outcome: 'created', remoteId: 'uid-9' });
    expect(calls[0]!.url).toContain("$filter=SupplierInvoiceNumber%20eq%20'PC-SC12-3'");
    expect((calls[1]!.init!.headers as Record<string, string>)['x-myobapi-key']).toBe('key');
  });
  it('never rewrites an existing document', async () => {
    const f: FetchLike = async () =>
      json({ Items: [{ UID: 'u1', RowVersion: '77', Status: 'Open' }] });
    expect(await createMyobProvider(session, f, noWait).push(doc, map)).toMatchObject({
      outcome: 'locked',
      remoteVersion: '77',
    });
  });
  it('reads supplier and customer payments against our references', async () => {
    const f: FetchLike = async (url) =>
      url.includes('SupplierPayment')
        ? json({
            Items: [
              {
                UID: 'sp',
                Date: '2026-10-20T00:00:00',
                Lines: [{ Purchase: { SupplierInvoiceNumber: 'PC-SC12-3' }, Amount: 100 }],
              },
            ],
          })
        : json({
            Items: [
              {
                UID: 'cp',
                Date: '2026-10-21T00:00:00',
                Invoices: [{ CustomerPurchaseOrderNumber: 'PC-HC-1', AmountApplied: 50 }],
              },
            ],
          });
    expect(await createMyobProvider(session, f, noWait).paymentsSince(new Date(0))).toEqual([
      {
        remoteId: 'sp:PC-SC12-3',
        documentReference: 'PC-SC12-3',
        paidOn: '2026-10-20',
        amountCents: 10_000,
      },
      {
        remoteId: 'cp:PC-HC-1',
        documentReference: 'PC-HC-1',
        paidOn: '2026-10-21',
        amountCents: 5_000,
      },
    ]);
  });
});

describe('contact matching', () => {
  const session = { accessToken: async () => 'at', tenantId: 'ten-1' };
  it('xero: an ABN matches by ABN only; a name is used only when there is no ABN', async () => {
    const urls: string[] = [];
    const answers = [{ Contacts: [] }, { Contacts: [{ ContactID: 'c-9' }] }];
    const fetchFn: FetchLike = async (url) => {
      urls.push(decodeURIComponent(url));
      return json(answers.shift() ?? { Contacts: [] });
    };
    const p = createXeroProvider(session, fetchFn, noWait);
    // ABN given, nothing found: no second lookup by name.
    expect(await p.findContact({ abn: '51 824 753 556', name: 'Acme' }, 'supplier')).toBeNull();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('TaxNumber=="51824753556"');
    // No ABN: exact name.
    expect(await p.findContact({ abn: null, name: 'Acme' }, 'supplier')).toEqual({
      remoteId: 'c-9',
      matchedBy: 'name',
    });
    expect(urls[1]).toContain('Name=="Acme"');
    // A malformed ABN or a name that cannot be quoted exactly matches nothing and sends nothing.
    expect(await p.findContact({ abn: '123', name: 'A' }, 'supplier')).toBeNull();
    expect(await p.findContact({ abn: null, name: 'Acme "Pty"' }, 'supplier')).toBeNull();
    expect(urls).toHaveLength(2);
  });
  it('myob: searches suppliers or customers by tax id then company name', async () => {
    const urls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      urls.push(decodeURIComponent(url));
      return json(url.includes('TaxIdNumber') ? { Items: [{ UID: 'u-1' }] } : { Items: [] });
    };
    const p = createMyobProvider(
      { accessToken: async () => 'at', apiKey: 'k', companyFileUrl: 'https://x/cf' },
      fetchFn,
      noWait,
    );
    expect(await p.findContact({ abn: '51824753556', name: 'A' }, 'customer')).toEqual({
      remoteId: 'u-1',
      matchedBy: 'abn',
    });
    expect(urls[0]).toContain('/Contact/Customer?$filter=TaxIdNumber eq');
  });
});

describe('rate limiter', () => {
  it('waits for the window when the per-minute budget is spent', async () => {
    let t = 0;
    const slept: number[] = [];
    const l = new RateLimiter(
      2,
      2,
      () => t,
      async (ms) => {
        slept.push(ms);
        t += ms;
      },
    );
    for (let i = 0; i < 3; i++) await l.run(async () => i);
    expect(slept).toEqual([60_000]);
  });
});

describe('tokens', () => {
  const vault = createTokenVault(Buffer.alloc(32, 7));
  it('round-trips and binds to the org', () => {
    const sealed = vault.seal('org-a', 'oauth-tokens', 'refresh-1');
    expect(vault.open('org-a', 'oauth-tokens', sealed)).toBe('refresh-1');
    expect(() => vault.open('org-b', 'oauth-tokens', sealed)).toThrow();
  });
  it('fails closed on an unknown version, including the old org-only layout', () => {
    const sealed = vault.seal('org-a', 'oauth-tokens', 'refresh-1');
    for (const v of [0, 1, 3]) {
      const bad = Buffer.from(sealed);
      bad[0] = v;
      expect(() => vault.open('org-a', 'oauth-tokens', bad)).toThrow('unknown token seal version');
    }
  });
  it('binds the purpose and the key', () => {
    const sealed = vault.seal('org-a', 'oauth-tokens', 'refresh-1');
    expect(() => vault.open('org-a', 'webhook-secret', sealed)).toThrow();
    expect(() =>
      createTokenVault(Buffer.alloc(32, 8)).open('org-a', 'oauth-tokens', sealed),
    ).toThrow();
  });
  it('builds a PKCE authorize url', () => {
    const { verifier, challenge } = newPkce();
    expect(verifier).not.toBe(challenge);
    const u = new URL(
      authorizeUrl('xero', { clientId: 'c', redirectUri: 'https://a/cb', state: 's', challenge }),
    );
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toContain('offline_access');
  });
  it('shares one refresh and persists the rotated token first', async () => {
    let now = 0;
    let refreshes = 0;
    const saved: string[] = [];
    const get = createTokenSession(
      { accessToken: 'a0', refreshToken: 'r0', expiresAt: 10 },
      async (r) => {
        refreshes++;
        return { accessToken: 'a1', refreshToken: `${r}+`, expiresAt: 1e9 };
      },
      async (t) => void saved.push(t.refreshToken),
      () => now,
    );
    now = 5;
    expect(await Promise.all([get(), get()])).toEqual(['a1', 'a1']);
    expect(refreshes).toBe(1);
    expect(saved).toEqual(['r0+']);
  });
});
