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
  const pm = await signUp(t.app, 'neg-pm');
  const org = await createOrg(pm.browser, 'Negotiating Builders');
  const project = await createProject(pm.browser, org.id, { name: 'Tower N', state: 'QLD' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const subs: Array<{ browser: Browser; companyId: string }> = [];
  for (const name of ['a', 'b', 'c']) {
    const u = await signUp(t.app, `neg-${name}`);
    const co = await addMember(
      pm.browser,
      org.id,
      project.id,
      u.email,
      'Subcontractor',
      `Secret Tiling ${name}`,
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

describe('Elena quote negotiation (EST-AC6)', () => {
  it('sets a confirmed quote against the field and sees no company, contact or note', async () => {
    const s = await setup();
    const dear = await s.quote(s.subs[0]!.browser, '30000.00', {
      exclusions: [{ text: 'Scaffolding' }],
      qualifications: [{ text: 'Subject to lead time' }],
    });
    await s.quote(s.subs[1]!.browser, '15000.00');
    await s.quote(s.subs[2]!.browser, '16000.00');
    const before = t.ai.calls.length;
    const res = await s.pm.browser.post(`${s.base}/ai/quote-negotiations`, {
      packageId: s.pkg,
      quoteId: dear,
    });
    expect(res.statusCode, res.body).toBe(200);
    const d = res.json();
    expect(d.runId).toMatch(/^air_/);
    expect(d.stance).toBe('above');
    expect(d.gap).toMatchObject({ against: 'median', referenceExGst: '26000.00' });
    expect(d.disclaimer).toMatch(/not a licensed agent/);
    expect(d.history.at(-1).role).toBe('elena');
    const call = t.ai.calls.slice(before).find((c) => c.task === 'quote.negotiate')!;
    expect(call.text).toContain('Scaffolding');
    expect(call.text).not.toMatch(/Secret Tiling|@|allowance/i);
  });

  it('measures against the target price the estimator sets', async () => {
    const s = await setup();
    const q = await s.quote(s.subs[0]!.browser, '30000.00');
    const res = await s.pm.browser.post(`${s.base}/ai/quote-negotiations`, {
      packageId: s.pkg,
      quoteId: q,
      targetExGst: '45000.00',
    });
    expect(res.json()).toMatchObject({
      stance: 'below',
      gap: { against: 'target', referenceExGst: '45000.00' },
    });
  });

  it('says there is no reference with fewer than three quotes and no target', async () => {
    const s = await setup();
    const q = await s.quote(s.subs[0]!.browser, null);
    const res = await s.pm.browser.post(`${s.base}/ai/quote-negotiations`, {
      packageId: s.pkg,
      quoteId: q,
    });
    expect(res.json()).toMatchObject({ stance: 'no_reference', counterExGst: null });
  });

  it('refuses a draft quote, a subcontractor and a zero target', async () => {
    const s = await setup();
    const draft = await s.quote(s.subs[0]!.browser, '30000.00', {}, false);
    const asked = (who: Browser, body: object) =>
      who.post(`${s.base}/ai/quote-negotiations`, { packageId: s.pkg, quoteId: draft, ...body });
    expect((await asked(s.pm.browser, {})).statusCode).toBe(404);
    const q = await s.quote(s.subs[1]!.browser, '30000.00');
    const own = await s.subs[1]!.browser.post(`${s.base}/ai/quote-negotiations`, {
      packageId: s.pkg,
      quoteId: q,
    });
    expect([403, 404]).toContain(own.statusCode);
    const zero = await s.pm.browser.post(`${s.base}/ai/quote-negotiations`, {
      packageId: s.pkg,
      quoteId: q,
      targetExGst: '0.00',
    });
    expect(zero.statusCode).toBe(422);
  });
});
