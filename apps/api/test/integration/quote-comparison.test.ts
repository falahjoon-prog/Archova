import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type Browser,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const etagOf = (res: { headers: Record<string, unknown> }) => res.headers.etag as string;
const scope = [
  { key: 'floor', description: 'Floor tiles', quantity: '120', unit: 'm2', source: 'typed' },
  { key: 'wall', description: 'Wall tiles', quantity: '96', unit: 'm2', source: 'typed' },
  { key: 'lining', description: 'Waterproof lining', quantity: '96', unit: 'm2', source: 'typed' },
];

type Cell = {
  quoteId: string;
  state: string;
  amountExGst: string | null;
  allowanceExGst: string | null;
  excluded: boolean;
  deviation: string | null;
};
type Column = Record<string, unknown> & { quoteId: string; companyId: string };
type Comparison = {
  packageId: string;
  columns: Column[];
  rows: Array<{ key: string; medianExGst: string | null; cells: Cell[] }>;
  medianTotalExGst: string | null;
  outlierRule: { percent: number; minExGst: string; minPrices: number };
};

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const org = await createOrg(pm.browser, `${label} Builder`);
  const project = await createProject(pm.browser, org.id, { name: 'Tower T', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subs: Array<{ browser: Browser; companyId: string }> = [];
  for (const name of ['a', 'b', 'c']) {
    const u = await signUp(t.app, `${label}-${name}`);
    const co = await addMember(
      pm.browser,
      org.id,
      project.id,
      u.email,
      'Subcontractor',
      `Tiles ${name.toUpperCase()}`,
    );
    subs.push({ browser: u.browser, companyId: co.companyId });
  }
  const client = await signUp(t.app, `${label}-client`);
  await addMember(pm.browser, org.id, project.id, client.email, 'Client', 'Client Co');
  return { pm, org, project, base, subs, client };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function sendPackage(s: Setup) {
  const draft = await s.pm.browser.post(`${s.base}/tender-packages`, {
    name: 'Tiling',
    trade: 'Tiling',
    dueAt: '2031-01-15T05:00:00Z',
    scope,
  });
  expect(draft.statusCode).toBe(201);
  const id = draft.json().id as string;
  await s.pm.browser.post(`${s.base}/tender-packages/${id}/invites`, {
    companyIds: s.subs.map((x) => x.companyId),
  });
  const sent = await s.pm.browser.post(
    `${s.base}/tender-packages/${id}/transition`,
    { action: 'send' },
    { 'if-match': etagOf(draft) },
  );
  expect(sent.json().status).toBe('out_to_tender');
  return id;
}

type Line = { scopeKey?: string; description: string; amount: string; isProvisional?: boolean };
async function submit(
  s: Setup,
  packageId: string,
  who: Browser,
  body: {
    lines: Line[];
    validUntil?: string;
    exclusions?: Array<{ text: string; scopeKey?: string }>;
  },
) {
  const res = await who.post(`${s.base}/tender-packages/${packageId}/quotes`, body);
  expect(res.statusCode, res.body).toBe(201);
  return { id: res.json().id as string, etag: etagOf(res) };
}
async function confirm(s: Setup, packageId: string, q: { id: string; etag: string }) {
  const res = await s.pm.browser.post(
    `${s.base}/tender-packages/${packageId}/quotes/${q.id}/confirm`,
    undefined,
    { 'if-match': q.etag },
  );
  expect(res.json().status).toBe('confirmed');
}
const compare = (b: Browser, s: Setup, packageId: string) =>
  b.get(`${s.base}/tender-packages/${packageId}/comparison`);

describe('quote comparison (EST-AC6)', () => {
  it('levels the confirmed quotes side by side and flags what the estimator looks for', async () => {
    const s = await setup('cmp');
    const pkg = await sendPackage(s);
    const [a, b, c] = s.subs as [(typeof s.subs)[0], (typeof s.subs)[0], (typeof s.subs)[0]];
    const qa = await submit(s, pkg, a.browser, {
      validUntil: '2031-03-01',
      lines: [
        { scopeKey: 'floor', description: 'Floors', amount: '4000.00' },
        { scopeKey: 'wall', description: 'Walls', amount: '7000.00' },
        { scopeKey: 'lining', description: 'Lining', amount: '5000.00' },
      ],
    });
    // B leaves the walls out.
    const qb = await submit(s, pkg, b.browser, {
      lines: [
        { scopeKey: 'floor', description: 'Floors', amount: '4100.00' },
        { scopeKey: 'lining', description: 'Lining', amount: '5100.00' },
      ],
    });
    // C is dear on floors, has a prime cost sum, a lapsed price, a line that matches no scope line and exclusions.
    const qc = await submit(s, pkg, c.browser, {
      validUntil: '2020-01-01',
      lines: [
        { scopeKey: 'floor', description: 'Floors', amount: '7000.00' },
        { scopeKey: 'wall', description: 'Walls', amount: '7200.00' },
        { scopeKey: 'lining', description: 'Lining PC', amount: '5050.00', isProvisional: true },
        { description: 'Site establishment', amount: '300.00' },
      ],
      exclusions: [
        { text: 'Excludes night work' },
        { text: 'Waterproofing by others', scopeKey: 'lining' },
      ],
    });
    // Nothing is confirmed yet, so nothing competes.
    expect((await compare(s.pm.browser, s, pkg)).json()).toMatchObject({ columns: [] });
    for (const q of [qa, qb, qc]) await confirm(s, pkg, q);

    const fresh = await s.pm.browser.get(`${s.base}/tender-packages/${pkg}`);
    const allowed = await s.pm.browser.put(
      `${s.base}/tender-packages/${pkg}/allowances`,
      { allowances: { [`${qb.id}:wall`]: '7100.00' } },
      { 'if-match': etagOf(fresh) },
    );
    expect(allowed.statusCode, allowed.body).toBe(200);

    const res = await compare(s.pm.browser, s, pkg);
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json() as Comparison;
    expect(r.packageId).toBe(pkg);
    expect(r.outlierRule).toEqual({ percent: 25, minExGst: '500.00', minPrices: 3 });
    expect(r.columns.map((x) => x.quoteId)).toEqual([qa.id, qb.id, qc.id]);
    expect(r.columns.map((x) => x.companyId)).toEqual(s.subs.map((x) => x.companyId));
    expect(r.columns.map((x) => [x.totalExGst, x.levelledTotalExGst, x.isLowest])).toEqual([
      ['16000.00', '16000.00', true],
      ['9200.00', '16300.00', false],
      ['19550.00', '19550.00', false],
    ]);
    expect(r.medianTotalExGst).toBe('16300.00');

    const [colA, colB, colC] = r.columns as [Column, Column, Column];
    expect(colA).toMatchObject({ validityExpired: false, missingScopeKeys: [], outlierLines: 0 });
    expect(colB).toMatchObject({
      allowancesExGst: '7100.00',
      missingScopeKeys: ['wall'],
      validityExpired: false,
    });
    expect(colC).toMatchObject({
      validityExpired: true,
      provisionalExGst: '5050.00',
      provisionalLines: 1,
      unmappedLines: 1,
      unmappedExGst: '300.00',
      outlierLines: 1,
    });
    expect((colC.exclusions as Array<{ text: string }>).map((e) => e.text)).toEqual([
      'Excludes night work',
      'Waterproofing by others',
    ]);

    const row = (key: string) => r.rows.find((x) => x.key === key)!;
    expect(r.rows.map((x) => x.key)).toEqual(['floor', 'wall', 'lining']);
    expect(row('floor').medianExGst).toBe('4100.00');
    expect(row('floor').cells.map((x) => [x.quoteId, x.amountExGst, x.deviation])).toEqual([
      [qa.id, '4000.00', null],
      [qb.id, '4100.00', null],
      [qc.id, '7000.00', 'high'],
    ]);
    // Two prices for the walls are too few for a median; B's gap carries the estimator's allowance.
    expect(row('wall').medianExGst).toBeNull();
    expect(row('wall').cells[1]).toMatchObject({
      state: 'missing',
      amountExGst: null,
      allowanceExGst: '7100.00',
    });
    expect(row('lining').cells[2]).toMatchObject({
      state: 'provisional',
      amountExGst: '5050.00',
      excluded: true,
    });
    expect(row('lining').cells[0]).toMatchObject({ state: 'priced', excluded: false });
  });

  it('compares only confirmed quotes: a revised quote replaces the old one once it is confirmed', async () => {
    const s = await setup('cmp-rev');
    const pkg = await sendPackage(s);
    const [a, b] = s.subs as [(typeof s.subs)[0], (typeof s.subs)[0]];
    const line = (amount: string): Line[] => [{ scopeKey: 'floor', description: 'Floors', amount }];
    const qa = await submit(s, pkg, a.browser, { lines: line('4000.00') });
    const qb = await submit(s, pkg, b.browser, { lines: line('4100.00') });
    await confirm(s, pkg, qa);
    await confirm(s, pkg, qb);
    const ids = async () =>
      ((await compare(s.pm.browser, s, pkg)).json() as Comparison).columns.map((x) => x.quoteId);
    expect(await ids()).toEqual([qa.id, qb.id]);

    // A revises: the first quote is superseded and the new one is not yet confirmed, so A drops out.
    const qa2 = await submit(s, pkg, a.browser, { lines: line('3900.00') });
    expect(await ids()).toEqual([qb.id]);
    await confirm(s, pkg, qa2);
    const after = (await compare(s.pm.browser, s, pkg)).json() as Comparison;
    expect(after.columns.map((x) => x.quoteId)).toEqual([qb.id, qa2.id]);
    expect(after.rows[0]!.cells.map((x) => x.amountExGst)).toEqual(['4100.00', '3900.00']);
    expect(after.columns.map((x) => x.isLowest)).toEqual([false, true]);
  });

  it('is for the estimator only: subcontractors, clients and outsiders cannot read competing prices', async () => {
    const s = await setup('cmp-scope');
    const pkg = await sendPackage(s);
    const [a, b] = s.subs as [(typeof s.subs)[0], (typeof s.subs)[0]];
    const qa = await submit(s, pkg, a.browser, {
      lines: [{ scopeKey: 'floor', description: 'Floors', amount: '4000.00' }],
    });
    const qb = await submit(s, pkg, b.browser, {
      lines: [{ scopeKey: 'floor', description: 'Floors', amount: '1234.56' }],
    });
    await confirm(s, pkg, qa);
    await confirm(s, pkg, qb);
    expect((await compare(s.pm.browser, s, pkg)).statusCode).toBe(200);

    // The sub who quoted can't see the comparison, nor can any other company or client.
    for (const who of [a.browser, b.browser, s.client.browser]) {
      const res = await compare(who, s, pkg);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('1234.56');
    }
    const stranger = await signUp(t.app, 'cmp-stranger');
    expect((await compare(stranger.browser, s, pkg)).statusCode).toBeGreaterThanOrEqual(400);

    // Another org's project id, and a package id that doesn't exist, are 404s.
    const other = await setup('cmp-other');
    expect(
      (
        await other.pm.browser.get(
          `/v1/orgs/${other.org.id}/projects/${s.project.id}/tender-packages/${pkg}/comparison`,
        )
      ).statusCode,
    ).toBe(404);
    expect((await compare(other.pm.browser, other, pkg)).statusCode).toBe(404);
  });
});
