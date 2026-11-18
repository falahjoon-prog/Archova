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
  const pm = await signUp(t.app, 'pmt-pm');
  const sub = await signUp(t.app, 'pmt-sub');
  const org = await createOrg(pm.browser, 'Permit Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower P', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sparkies');
  return { pm, sub, base };
}

const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('Permits register', () => {
  it('adds, numbers, derives status, and keeps a history', async () => {
    const s = await setup();
    const a = await s.pm.browser.post(`${s.base}/permits`, {
      kind: 'building_permit',
      title: 'Stage 1 building permit',
      issuingAuthority: 'City Council',
      referenceNumber: 'BP-2026-0042',
      issuedOn: inDays(-300),
      expiresOn: inDays(10),
    });
    expect(a.statusCode).toBe(201);
    expect(a.json().permit).toMatchObject({
      numberLabel: 'PMT-0001',
      status: 'expiring_soon',
      lifecycle: 'active',
    });
    const b = await s.pm.browser.post(`${s.base}/permits`, {
      kind: 'hot_work',
      title: 'Hot work',
      expiresOn: inDays(-3),
    });
    expect(b.json().permit).toMatchObject({ numberLabel: 'PMT-0002', status: 'expired' });

    const expired = await s.pm.browser.get(`${s.base}/permits?status=expired`);
    expect(expired.json().data.map((p: { numberLabel: string }) => p.numberLabel)).toEqual([
      'PMT-0002',
    ]);
    expect((await s.pm.browser.get(`${s.base}/permits`)).json().data).toHaveLength(2);

    const bad = await s.pm.browser.post(`${s.base}/permits`, {
      kind: 'hot_work',
      title: 'Backwards',
      issuedOn: inDays(5),
      expiresOn: inDays(1),
    });
    expect(bad.statusCode).toBe(422);
  });

  it('renews: start, then mark renewed with a later date, and rejects stale versions', async () => {
    const s = await setup();
    const created = (
      await s.pm.browser.post(`${s.base}/permits`, {
        kind: 'council_approval',
        title: 'Footpath occupation',
        expiresOn: inDays(5),
      })
    ).json().permit;
    const started = await s.pm.browser.post(
      `${s.base}/permits/${created.id}/transition`,
      { action: 'startRenewal' },
      ifMatch(created.version),
    );
    expect(started.statusCode).toBe(200);
    expect(started.json().permit).toMatchObject({ status: 'renewal_in_progress' });
    const stale = await s.pm.browser.post(
      `${s.base}/permits/${created.id}/transition`,
      { action: 'close' },
      ifMatch(created.version),
    );
    expect(stale.statusCode).toBe(412);
    const v2 = started.json().permit.version;
    const noDate = await s.pm.browser.post(
      `${s.base}/permits/${created.id}/transition`,
      { action: 'markRenewed' },
      ifMatch(v2),
    );
    expect(noDate.statusCode).toBe(409);
    const renewed = await s.pm.browser.post(
      `${s.base}/permits/${created.id}/transition`,
      { action: 'markRenewed', newExpiresOn: inDays(365) },
      ifMatch(v2),
    );
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json().permit).toMatchObject({ status: 'active', lifecycle: 'active' });
    expect(renewed.json().events.map((e: { action: string }) => e.action)).toEqual([
      'add',
      'startRenewal',
      'markRenewed',
    ]);
  });

  it('flags expiring, expired and missing required permits', async () => {
    const s = await setup();
    await s.pm.browser.post(`${s.base}/permits`, {
      kind: 'hot_work',
      title: 'Old',
      expiresOn: inDays(-2),
    });
    await s.pm.browser.post(`${s.base}/permits`, {
      kind: 'demolition',
      title: 'Soon',
      expiresOn: inDays(6),
    });
    const put = await s.pm.browser.put(`${s.base}/permits/requirements`, {
      items: [{ kind: 'building_permit', leadDays: 45 }],
    });
    expect(put.statusCode).toBe(200);
    const flags = (await s.pm.browser.get(`${s.base}/permits/flags`)).json().data;
    expect(flags.map((f: { kind: string }) => f.kind).sort()).toEqual([
      'expired',
      'expiring',
      'missing_required',
    ]);
    // Clearing the requirement switches the missing flag off.
    await s.pm.browser.put(`${s.base}/permits/requirements`, { items: [] });
    const after = (await s.pm.browser.get(`${s.base}/permits/flags`)).json().data;
    expect(after.some((f: { kind: string }) => f.kind === 'missing_required')).toBe(false);
  });

  it('lets a subcontractor read the register but not change it', async () => {
    const s = await setup();
    const p = (
      await s.pm.browser.post(`${s.base}/permits`, { kind: 'other', title: 'Misc' })
    ).json().permit;
    expect((await s.sub.browser.get(`${s.base}/permits`)).statusCode).toBe(200);
    expect((await s.sub.browser.get(`${s.base}/permits/${p.id}`)).statusCode).toBe(200);
    expect(
      (await s.sub.browser.post(`${s.base}/permits`, { kind: 'other', title: 'Nope' })).statusCode,
    ).toBe(403);
    expect(
      (
        await s.sub.browser.patch(
          `${s.base}/permits/${p.id}`,
          { title: 'Nope' },
          ifMatch(p.version),
        )
      ).statusCode,
    ).toBe(403);
  });
});
