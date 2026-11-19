import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Browser,
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  uploadFile,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup() {
  const pm = await signUp(t.app, 'ops-pm');
  const client = await signUp(t.app, 'ops-client');
  const org = await createOrg(pm.browser, 'Share Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower S', state: 'NSW' });
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  const portal = `${base}/owner-portal`;
  await addMember(pm.browser, org.id, project.id, client.email, 'Client', 'Harbour Developments');
  return { pm, client, org, project, base, portal };
}

const jpeg = () =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 24 }, (_, i) => i)]);
const update = (title: string) => ({
  title,
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  summary: `${title}: slab poured.`,
  percentComplete: 35,
  milestones: [
    { name: 'Level 2 slab', date: '2026-10-20', status: 'done' },
    { name: 'Lock-up', date: '2026-12-15', status: 'on_track' },
    { name: 'Roof on', date: '2026-11-30', status: 'at_risk' },
  ],
});
const tokenOf = (url: string) => url.split('/c/')[1]!;

describe('client share link', () => {
  it('shows the client published progress, upcoming milestones, approved changes and picked photos, and nothing with a price', async () => {
    const s = await setup();
    const { pm } = s;

    // Published and draft updates; only the published one is ever shown.
    const draft = (await pm.browser.post(`${s.portal}/progress-updates`, update('Draft'))).json();
    const pub = (await pm.browser.post(`${s.portal}/progress-updates`, update('October'))).json();
    await pm.browser.post(`${s.portal}/progress-updates/${pub.id}/publish`);

    // A client decision (with a price the builder keeps off the link) and two variations: head and subcontract.
    const req = (
      await pm.browser.post(`${s.portal}/approvals`, {
        title: 'Lobby stone upgrade',
        amountCents: 4_500_000,
      })
    ).json();
    await s.client.browser.post(`${s.portal}/approvals/${req.id}/decision`, {
      decision: 'approved',
    });
    await pm.browser.post(`${s.portal}/approvals`, { title: 'Still waiting on you' });
    const contractBody = (kind: 'head' | 'subcontract', title: string) => ({
      kind,
      title,
      originalValue: '777000.00',
      retentionPct: '5.00',
      sov: [{ code: 'A1', description: 'All', value: '777000.00' }],
    });
    const headContract = (
      await pm.browser.post(`${s.base}/contracts`, contractBody('head', 'Head'))
    ).json().contract;
    const subContract = (
      await pm.browser.post(`${s.base}/contracts`, contractBody('subcontract', 'Sub'))
    ).json().contract;
    for (const [c, title, amount] of [
      [headContract, 'Extra car bays', '123456.00'],
      [subContract, 'Subbie rework', '98765.00'],
    ] as const) {
      const v = (
        await pm.browser.post(`${s.base}/contracts/${c.id}/variations`, {
          title,
          amount,
          timeImpactDays: 4,
        })
      ).json();
      await pm.browser.post(`${s.base}/variations/${v.id}/submit`, {});
      await pm.browser.post(`${s.base}/variations/${v.id}/approve`, {});
    }

    // Two photos exist; only one is picked.
    const picked = await uploadBytes(
      t,
      pm.browser,
      s.org.id,
      s.project.id,
      jpeg(),
      'slab.jpg',
      'image/jpeg',
      'diary',
    );
    await uploadBytes(
      t,
      pm.browser,
      s.org.id,
      s.project.id,
      jpeg(),
      'private.jpg',
      'image/jpeg',
      'diary',
    );
    const added = await pm.browser.post(`${s.portal}/shared-photos`, {
      fileId: picked,
      caption: 'Level 2 slab',
    });
    expect(added.statusCode).toBe(200);

    // The client (a project member) cannot issue links.
    expect(
      (await s.client.browser.post(`${s.portal}/share-links`, { label: 'nope' })).statusCode,
    ).toBe(403);

    const made = await pm.browser.post(`${s.portal}/share-links`, {
      label: 'Harbour board',
      recipientEmail: 'board@harbour.example.com',
    });
    expect(made.statusCode).toBe(201);
    const { url, link, emailed } = made.json();
    expect(emailed).toBe(true);
    expect(t.messages.sent.filter((m) => m.to === 'board@harbour.example.com')).toHaveLength(1);
    expect(link).toMatchObject({ label: 'Harbour board', state: 'active' });
    // The list never shows the token again.
    const listed = (await pm.browser.get(`${s.portal}/share-links`)).json();
    expect(JSON.stringify(listed)).not.toMatch(/arl_/);

    const guest = new Browser(t.app);
    const opened = await guest.post('/v1/owner-portal-access', { token: tokenOf(url) });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers['referrer-policy']).toBe('no-referrer');
    expect(opened.headers['cache-control']).toBe('no-store');
    const body = opened.json();
    expect(body.project).toMatchObject({ name: 'Tower S', fromOrg: 'Share Builder' });
    expect(body.project.timezone).toBeTruthy();
    expect(body.progress).toMatchObject({ title: 'October', percentComplete: 35 });
    expect(body.updates).toHaveLength(1);
    // Finished milestones drop off; the rest are soonest first.
    expect(body.milestones.map((m: { name: string }) => m.name)).toEqual(['Roof on', 'Lock-up']);
    expect(body.changes.map((c: { title: string }) => c.title).sort()).toEqual([
      'Extra car bays',
      'Lobby stone upgrade',
    ]);
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0]).toMatchObject({ caption: 'Level 2 slab' });
    expect(body.photos[0].url).toMatch(/^(https?|memory):/);

    // Nothing internal leaks: no amounts, no draft, no subcontract variation, no unpicked photo.
    const raw = JSON.stringify(body);
    for (const leak of [
      '123456',
      '98765',
      '4500000',
      '777000',
      'Draft',
      'Subbie',
      'Still waiting',
      'private.jpg',
      'amount',
    ])
      expect(raw).not.toContain(leak);
    void draft;

    // The session works on its own, and a fresh browser with no cookie does not.
    expect((await guest.get('/v1/owner-portal-access')).statusCode).toBe(200);
    expect((await new Browser(t.app).get('/v1/owner-portal-access')).json().code).toBe(
      'access_link.session_required',
    );
    // The link cannot be used for anything else: the staff API refuses the guest cookie.
    expect((await guest.get(`${s.portal}/progress-updates`)).statusCode).toBe(401);
  });

  it('stops working the moment it is revoked, and a link from another project cannot be revoked here', async () => {
    const s = await setup();
    const other = await setup();
    const made = (await s.pm.browser.post(`${s.portal}/share-links`, {})).json();
    const guest = new Browser(t.app);
    expect(
      (await guest.post('/v1/owner-portal-access', { token: tokenOf(made.url) })).statusCode,
    ).toBe(200);

    expect(
      (await other.pm.browser.post(`${other.portal}/share-links/${made.link.id}/revoke`))
        .statusCode,
    ).toBe(404);
    const revoked = await s.pm.browser.post(`${s.portal}/share-links/${made.link.id}/revoke`);
    expect(revoked.json()).toMatchObject({ state: 'revoked' });

    expect((await guest.get('/v1/owner-portal-access')).json().code).toBe('access_link.invalid');
    expect(
      (
        await new Browser(t.app).post('/v1/owner-portal-access', { token: tokenOf(made.url) })
      ).json().code,
    ).toBe('access_link.invalid');
    // An unknown token looks the same.
    expect(
      (
        await new Browser(t.app).post('/v1/owner-portal-access', { token: `arl_${'A'.repeat(64)}` })
      ).json().code,
    ).toBe('access_link.invalid');
  });

  it('only lets the builder share photos from this project', async () => {
    const s = await setup();
    const other = await setup();
    const pdf = await uploadFile(t, s.pm.browser, s.org.id, s.project.id);
    expect((await s.pm.browser.post(`${s.portal}/shared-photos`, { fileId: pdf })).statusCode).toBe(
      422,
    );
    const foreign = await uploadBytes(
      t,
      other.pm.browser,
      other.org.id,
      other.project.id,
      jpeg(),
      'x.jpg',
      'image/jpeg',
      'diary',
    );
    expect(
      (await s.pm.browser.post(`${s.portal}/shared-photos`, { fileId: foreign })).statusCode,
    ).toBeGreaterThanOrEqual(400);

    const mine = await uploadBytes(
      t,
      s.pm.browser,
      s.org.id,
      s.project.id,
      jpeg(),
      'a.jpg',
      'image/jpeg',
      'diary',
    );
    await s.pm.browser.post(`${s.portal}/shared-photos`, { fileId: mine, caption: 'a' });
    const removed = await s.pm.browser.del(`${s.portal}/shared-photos/${mine}`);
    expect(removed.json().data).toEqual([]);
  });
});
