import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

// Dashboard snapshots: the portfolio dashboard saved as data, reopened exactly as it was.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Snap = {
  id: string;
  title: string;
  currentAsOf: string;
  program: string | null;
  createdBy: { id: string; name: string | null };
  dashboard?: {
    totals: Record<string, number>;
    projects: Array<{ name: string; rfis: { open: number } }>;
  };
};

async function openRfi(
  browser: Awaited<ReturnType<typeof signUp>>['browser'],
  base: string,
  userId: string,
  subject: string,
) {
  const draft = await browser.post(`${base}/rfis`, {
    subject,
    question: 'Which detail governs?',
    assigneeIds: [userId],
    dueDate: '2099-01-10',
  });
  expect(draft.statusCode).toBe(201);
  const opened = await browser.post(`${base}/rfis/${draft.json().rfi.id}/open`, undefined, {
    'if-match': draft.headers.etag as string,
  });
  expect(opened.statusCode).toBe(200);
}

describe('Dashboard snapshots', () => {
  it('captures the dashboard as it was, and keeps it while the live numbers move on', async () => {
    const pm = await signUp(t.app, 'snap-pm');
    const org = await createOrg(pm.browser, 'Snapshot Co');
    const a = await createProject(pm.browser, org.id, { name: 'Snap Alpha', state: 'QLD' });
    const base = `/v1/orgs/${org.id}/projects/${a.id}`;
    await openRfi(pm.browser, base, pm.userId, 'First');
    const path = `/v1/orgs/${org.id}/dashboard-snapshots`;

    const made = await pm.browser.post(
      path,
      { title: 'Monthly Report - Nov', program: ' Stage 1 ' },
      { 'idempotency-key': 'snap-1' },
    );
    expect(made.statusCode).toBe(201);
    const snap = made.json() as Snap;
    expect(snap.title).toBe('Monthly Report - Nov');
    expect(snap.program).toBe('Stage 1');
    expect(snap.currentAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snap.createdBy.id).toBe(pm.userId);
    expect(snap.createdBy.name).toBeTruthy();
    expect(snap.dashboard?.projects.find((p) => p.name === 'Snap Alpha')?.rfis.open).toBe(1);

    await openRfi(pm.browser, base, pm.userId, 'Second');
    const live = (await pm.browser.get(`/v1/orgs/${org.id}/portfolio`)).json() as NonNullable<
      Snap['dashboard']
    >;
    expect(live.projects.find((p) => p.name === 'Snap Alpha')?.rfis.open).toBe(2);

    const reopened = (await pm.browser.get(`${path}/${snap.id}`)).json() as Snap;
    expect(reopened.dashboard?.projects.find((p) => p.name === 'Snap Alpha')?.rfis.open).toBe(1);

    const list = (await pm.browser.get(path)).json() as { data: Snap[] };
    expect(list.data.map((s) => s.id)).toEqual([snap.id]);
    expect(list.data[0]).not.toHaveProperty('dashboard');

    expect((await pm.browser.del(`${path}/${snap.id}`)).statusCode).toBe(204);
    expect((await pm.browser.get(`${path}/${snap.id}`)).statusCode).toBe(404);
    expect(((await pm.browser.get(path)).json() as { data: Snap[] }).data).toEqual([]);
  });

  it('refuses a blank title, a bad or future date and a long tag', async () => {
    const pm = await signUp(t.app, 'snap-val');
    const org = await createOrg(pm.browser, 'Snapshot Val Co');
    const path = `/v1/orgs/${org.id}/dashboard-snapshots`;
    const post = (body: object) =>
      pm.browser.post(path, body, { 'idempotency-key': crypto.randomUUID() });
    expect((await post({ title: '   ' })).statusCode).toBe(422);
    expect((await post({ title: 'x', currentAsOf: '2026-02-31' })).statusCode).toBe(422);
    expect((await post({ title: 'x', currentAsOf: '2099-01-01' })).statusCode).toBe(422);
    expect((await post({ title: 'x', program: 'p'.repeat(81) })).statusCode).toBe(422);
    expect((await post({ title: 'x', currentAsOf: '2020-01-31' })).statusCode).toBe(201);
  });

  it('keeps snapshots from non-staff members and from other companies', async () => {
    const owner = await signUp(t.app, 'snap-owner');
    const staff = await signUp(t.app, 'snap-staff');
    const org = await createOrg(owner.browser, 'Snapshot Priv Co');
    const p = await createProject(owner.browser, org.id, { name: 'Priv Alpha', state: 'QLD' });
    await addMember(owner.browser, org.id, p.id, staff.email, 'Subcontractor', 'Sparky');
    const path = `/v1/orgs/${org.id}/dashboard-snapshots`;
    const made = await owner.browser.post(
      path,
      { title: 'Board pack' },
      { 'idempotency-key': 'priv-1' },
    );
    const id = (made.json() as Snap).id;
    // A project member who is not company staff cannot open snapshots at all.
    expect((await staff.browser.get(`${path}/${id}`)).statusCode).toBe(403);
    const other = await signUp(t.app, 'snap-other');
    const otherOrg = await createOrg(other.browser, 'Other Snap Co');
    const res = await other.browser.get(`/v1/orgs/${otherOrg.id}/dashboard-snapshots/${id}`);
    expect(res.statusCode).toBe(404);
    expect(
      (
        (await other.browser.get(`/v1/orgs/${otherOrg.id}/dashboard-snapshots`)).json() as {
          data: Snap[];
        }
      ).data,
    ).toEqual([]);
  });
});
