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

async function setup() {
  const pm = await signUp(t.app, 'ins-pm');
  const sub = await signUp(t.app, 'ins-sub');
  const org = await createOrg(pm.browser, 'Insurance Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower I', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}/insurance`;
  const { companyId } = await addMember(
    pm.browser,
    org.id,
    project.id,
    sub.email,
    'Subcontractor',
    'Sparkies',
  );
  return { pm, sub, base, companyId };
}

const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('Insurance and bonds register', () => {
  it('adds, numbers, derives status and keeps a history', async () => {
    const s = await setup();
    const a = await s.pm.browser.post(`${s.base}/covers`, {
      kind: 'public_liability',
      title: 'Sparkies public liability',
      companyId: s.companyId,
      issuer: 'QBE',
      referenceNumber: 'PL-99812',
      amountCents: 2_000_000_000,
      issuedOn: inDays(-300),
      expiresOn: inDays(10),
    });
    expect(a.statusCode).toBe(201);
    expect(a.json().cover).toMatchObject({
      numberLabel: 'INS-0001',
      category: 'insurance',
      status: 'expiring_soon',
      companyId: s.companyId,
    });
    const b = await s.pm.browser.post(`${s.base}/covers`, {
      kind: 'performance_bond',
      title: 'Performance bond 5%',
      companyId: s.companyId,
      expiresOn: inDays(-3),
    });
    expect(b.json().cover).toMatchObject({
      numberLabel: 'INS-0002',
      category: 'bond',
      status: 'expired',
    });

    const expired = await s.pm.browser.get(`${s.base}/covers?status=expired`);
    expect(expired.json().data.map((c: { numberLabel: string }) => c.numberLabel)).toEqual([
      'INS-0002',
    ]);
    const mine = await s.pm.browser.get(`${s.base}/covers?companyId=${s.companyId}`);
    expect(mine.json().data).toHaveLength(2);

    const backwards = await s.pm.browser.post(`${s.base}/covers`, {
      kind: 'workers_comp',
      title: 'Backwards',
      companyId: s.companyId,
      issuedOn: inDays(5),
      expiresOn: inDays(1),
    });
    expect(backwards.statusCode).toBe(422);
    const stranger = await s.pm.browser.post(`${s.base}/covers`, {
      kind: 'workers_comp',
      title: 'Not on project',
      companyId: 'cmp_00000000000000000000000000',
    });
    expect([404, 422]).toContain(stranger.statusCode);
  });

  it('renews: start, then mark renewed with a later date, and rejects stale versions', async () => {
    const s = await setup();
    const created = (
      await s.pm.browser.post(`${s.base}/covers`, {
        kind: 'retention_bond',
        title: 'Retention bond',
        companyId: s.companyId,
        expiresOn: inDays(5),
      })
    ).json().cover;
    const started = await s.pm.browser.post(
      `${s.base}/covers/${created.id}/transition`,
      { action: 'startRenewal' },
      ifMatch(created.version),
    );
    expect(started.json().cover).toMatchObject({ status: 'renewal_in_progress' });
    const stale = await s.pm.browser.post(
      `${s.base}/covers/${created.id}/transition`,
      { action: 'close' },
      ifMatch(created.version),
    );
    expect(stale.statusCode).toBe(412);
    const v2 = started.json().cover.version;
    const noDate = await s.pm.browser.post(
      `${s.base}/covers/${created.id}/transition`,
      { action: 'markRenewed' },
      ifMatch(v2),
    );
    expect(noDate.statusCode).toBe(409);
    const renewed = await s.pm.browser.post(
      `${s.base}/covers/${created.id}/transition`,
      { action: 'markRenewed', newExpiresOn: inDays(365) },
      ifMatch(v2),
    );
    expect(renewed.json().cover).toMatchObject({ status: 'active' });
    expect(renewed.json().events.map((e: { action: string }) => e.action)).toEqual([
      'add',
      'startRenewal',
      'markRenewed',
    ]);
  });

  it('flags expiring, expired and missing covers, and clears the missing flag with the requirement', async () => {
    const s = await setup();
    await s.pm.browser.post(`${s.base}/covers`, {
      kind: 'public_liability',
      title: 'Old PL',
      companyId: s.companyId,
      expiresOn: inDays(-2),
    });
    await s.pm.browser.post(`${s.base}/covers`, {
      kind: 'contract_works',
      title: 'CW',
      companyId: s.companyId,
      expiresOn: inDays(6),
    });
    const put = await s.pm.browser.put(`${s.base}/requirements`, {
      items: [{ kind: 'workers_comp', leadDays: 45, minAmountCents: null }],
    });
    expect(put.statusCode).toBe(200);
    const flags = (await s.pm.browser.get(`${s.base}/flags`)).json().data;
    expect(flags.map((f: { kind: string }) => f.kind).sort()).toEqual([
      'expired',
      'expiring',
      'missing',
    ]);
    await s.pm.browser.put(`${s.base}/requirements`, { items: [] });
    const after = (await s.pm.browser.get(`${s.base}/flags`)).json().data;
    expect(after.some((f: { kind: string }) => f.kind === 'missing')).toBe(false);
  });

  it('answers the gate for one company: cleared, warning, then blocked', async () => {
    const s = await setup();
    const clearance = async () =>
      (await s.pm.browser.get(`${s.base}/companies/${s.companyId}/clearance`)).json();
    // No requirements, nothing recorded: nothing to block on, and it says so.
    expect(await clearance()).toMatchObject({ state: 'cleared', requirementsSet: false });

    await s.pm.browser.put(`${s.base}/requirements`, {
      items: [
        { kind: 'public_liability', leadDays: 30, minAmountCents: 2_000_000_000 },
        { kind: 'workers_comp', leadDays: 30, minAmountCents: null },
      ],
    });
    expect(await clearance()).toMatchObject({ state: 'blocked', requirementsSet: true });

    await s.pm.browser.post(`${s.base}/covers`, {
      kind: 'workers_comp',
      title: 'WC',
      companyId: s.companyId,
      expiresOn: inDays(200),
    });
    const pl = (
      await s.pm.browser.post(`${s.base}/covers`, {
        kind: 'public_liability',
        title: 'PL',
        companyId: s.companyId,
        amountCents: 500_000_000,
        expiresOn: inDays(200),
      })
    ).json().cover;
    const low = await clearance();
    expect(low.state).toBe('warning');
    expect(low.issues.map((i: { kind: string }) => i.kind)).toEqual(['below_minimum']);

    await s.pm.browser.patch(
      `${s.base}/covers/${pl.id}`,
      { amountCents: 2_000_000_000 },
      ifMatch(pl.version),
    );
    expect(await clearance()).toMatchObject({ state: 'cleared', issues: [] });

    const upd = (await s.pm.browser.get(`${s.base}/covers/${pl.id}`)).json().cover;
    await s.pm.browser.patch(
      `${s.base}/covers/${pl.id}`,
      { expiresOn: inDays(-1) },
      ifMatch(upd.version),
    );
    const lapsed = await clearance();
    expect(lapsed.state).toBe('blocked');
    expect(lapsed.issues[0]).toMatchObject({ kind: 'expired', level: 'blocking' });
  });

  it('lets a subcontractor read the register but not change it', async () => {
    const s = await setup();
    const c = (
      await s.pm.browser.post(`${s.base}/covers`, {
        kind: 'workers_comp',
        title: 'WC',
        companyId: s.companyId,
      })
    ).json().cover;
    expect((await s.sub.browser.get(`${s.base}/covers`)).statusCode).toBe(200);
    expect((await s.sub.browser.get(`${s.base}/covers/${c.id}`)).statusCode).toBe(200);
    expect(
      (
        await s.sub.browser.post(`${s.base}/covers`, {
          kind: 'workers_comp',
          title: 'Nope',
          companyId: s.companyId,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await s.sub.browser.patch(`${s.base}/covers/${c.id}`, { title: 'Nope' }, ifMatch(c.version)))
        .statusCode,
    ).toBe(403);
    expect((await s.sub.browser.put(`${s.base}/requirements`, { items: [] })).statusCode).toBe(403);
  });
});
