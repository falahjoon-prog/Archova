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
const SCOPE = [
  { key: 'floor', description: 'Floor tiles', quantity: '120', unit: 'm2', source: 'typed' },
  { key: 'wall', description: 'Wall tiles', quantity: '96', unit: 'm2', source: 'typed' },
];

async function setup() {
  const pm = await signUp(t.app, 'lvl-pm');
  const org = await createOrg(pm.browser, 'Levelling Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Tower L', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subs: Array<{ browser: Browser; companyId: string }> = [];
  for (const name of ['a', 'b', 'c']) {
    const u = await signUp(t.app, `lvl-${name}`);
    const co = await addMember(
      pm.browser,
      org.id,
      project.id,
      u.email,
      'Subcontractor',
      `Secret Tiler ${name}`,
    );
    subs.push({ browser: u.browser, companyId: co.companyId });
  }
  const draft = await pm.browser.post(`${base}/tender-packages`, {
    name: 'Tiling',
    trade: 'Tiling',
    dueAt: '2031-01-15T05:00:00Z',
    scope: SCOPE,
  });
  const id = draft.json().id as string;
  await pm.browser.post(`${base}/tender-packages/${id}/invites`, {
    companyIds: subs.map((s) => s.companyId),
  });
  await pm.browser.post(
    `${base}/tender-packages/${id}/transition`,
    { action: 'send' },
    { 'if-match': etagOf(draft) },
  );
  const quote = async (who: Browser, wall: string | null, extra: object = {}, confirmIt = true) => {
    const lines = [{ scopeKey: 'floor', description: 'Floors', amount: '10000.00' }];
    if (wall) lines.push({ scopeKey: 'wall', description: 'Walls', amount: wall });
    const res = await who.post(`${base}/tender-packages/${id}/quotes`, { lines, ...extra });
    const q = { id: res.json().id as string, etag: etagOf(res) };
    if (confirmIt)
      await pm.browser.post(`${base}/tender-packages/${id}/quotes/${q.id}/confirm`, undefined, {
        'if-match': q.etag,
      });
    return q.id;
  };
  return { pm, subs, base, pkg: id, quote };
}

describe('Nova bid levelling (EST-AC6)', () => {
  it('levels the confirmed bids, anonymously, and names each bid by label only', async () => {
    const s = await setup();
    // Bid A leaves the wall out; B and C price both lines.
    await s.quote(s.subs[0]!.browser, null, {
      exclusions: [{ text: 'Wall tiling by others', scopeKey: 'wall' }],
    });
    await s.quote(s.subs[1]!.browser, '15000.00');
    await s.quote(s.subs[2]!.browser, '16000.00');
    const before = t.ai.calls.length;
    const res = await s.pm.browser.post(`${s.base}/ai/bid-levellings`, { packageId: s.pkg });
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json();
    expect(d.runId).toMatch(/^air_/);
    expect(d.bids).toHaveLength(3);
    const a = d.bids.find((b: { label: string }) => b.label === 'Bid A');
    expect(a.gaps).toEqual([{ scopeKey: 'wall', reason: 'excluded', allowanceExGst: '15500.00' }]);
    expect(a.normalisedExGst).toBe('25500.00');
    expect(a.rank).toBe(2);
    expect(d.medianNormalisedExGst).toBe('25500.00');
    expect(d.recommendation).toMatchObject({ bid: 'Bid B', isLowestNormalised: true });
    expect(d.recommendation.quoteId).toBeTruthy();
    expect(d.disclaimer).toMatch(/not a licensed agent/);
    expect(d.history.at(-1).role).toBe('nova');
    const call = t.ai.calls.slice(before).find((c) => c.task === 'bid.level')!;
    expect(call.text).toContain('Wall tiling by others');
    expect(call.text).toContain('Bid B');
    expect(call.text).not.toMatch(/Secret Tiler|@/i);
  });

  it('refuses with no confirmed bids, for a subcontractor, and for an unknown package', async () => {
    const s = await setup();
    const none = await s.pm.browser.post(`${s.base}/ai/bid-levellings`, { packageId: s.pkg });
    expect(none.statusCode).toBe(422);
    await s.quote(s.subs[0]!.browser, '15000.00');
    const own = await s.subs[0]!.browser.post(`${s.base}/ai/bid-levellings`, { packageId: s.pkg });
    expect([403, 404]).toContain(own.statusCode);
    const unknown = await s.pm.browser.post(`${s.base}/ai/bid-levellings`, {
      packageId: 'tpk_00000000000000000000000000',
    });
    expect(unknown.statusCode).toBe(404);
  });
});
