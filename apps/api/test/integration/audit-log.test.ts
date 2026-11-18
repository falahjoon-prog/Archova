import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

// The audit log: who did what, when, read from the events every change writes.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Line = {
  id: string;
  at: string;
  action: string;
  module: string;
  projectId: string | null;
  projectName: string | null;
  actor: { kind: string; id: string | null; name: string | null };
};
type Page = { data: Line[]; nextCursor: string | null };

async function setup() {
  const pm = await signUp(t.app, 'aud-pm');
  const sub = await signUp(t.app, 'aud-sub');
  const org = await createOrg(pm.browser, 'Audit Co');
  const a = await createProject(pm.browser, org.id, { name: 'Audit Alpha', state: 'QLD' });
  const b = await createProject(pm.browser, org.id, { name: 'Audit Bravo', state: 'QLD' });
  await addMember(pm.browser, org.id, a.id, sub.email, 'Subcontractor', 'Sparky');
  for (const [project, subject] of [
    [a, 'Slab edge detail'],
    [a, 'Balustrade height'],
    [b, 'Stair nosing'],
  ] as const) {
    const r = await pm.browser.post(`/v1/orgs/${org.id}/projects/${project.id}/rfis`, {
      subject,
      question: 'Which detail governs?',
      assigneeIds: [pm.userId],
    });
    expect(r.statusCode).toBe(201);
  }
  return { pm, sub, org, a, b, path: `/v1/orgs/${org.id}/audit-log` };
}

describe('Audit log', () => {
  it('lists who did what newest first, with names and project, and filters', async () => {
    const { pm, a, b, path } = await setup();
    const all = await pm.browser.get(path);
    expect(all.statusCode).toBe(200);
    const page = all.json() as Page;
    const rfis = page.data.filter((l) => l.action === 'rfis.rfi.created');
    expect(rfis.length).toBe(3);
    expect(rfis.every((l) => l.module === 'rfis' && l.actor.kind === 'user')).toBe(true);
    expect(rfis.every((l) => l.actor.id === pm.userId && l.actor.name)).toBe(true);
    const times = page.data.map((l) => l.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(rfis.map((l) => l.projectName).sort()).toEqual([
      'Audit Alpha',
      'Audit Alpha',
      'Audit Bravo',
    ]);
    // The details of an event are never returned.
    expect(JSON.stringify(page)).not.toContain('Which detail governs');

    const onlyB = (await pm.browser.get(`${path}?projectId=${b.id}`)).json() as Page;
    expect(onlyB.data.length).toBeGreaterThan(0);
    expect(onlyB.data.every((l) => l.projectId === b.id)).toBe(true);
    const onlyA = (await pm.browser.get(`${path}?projectId=${a.id}&module=rfis`)).json() as Page;
    expect(onlyA.data.filter((l) => l.action === 'rfis.rfi.created').length).toBe(2);
    expect(onlyA.data.every((l) => l.module === 'rfis' && l.projectId === a.id)).toBe(true);
    const future = (await pm.browser.get(`${path}?from=2099-01-01T00:00:00Z`)).json() as Page;
    expect(future.data).toEqual([]);
  });

  it('pages with a cursor without repeating or skipping a line', async () => {
    const { pm, path } = await setup();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const res = await pm.browser.get(`${path}?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.statusCode).toBe(200);
      const p = res.json() as Page;
      expect(p.data.length).toBeLessThanOrEqual(2);
      seen.push(...p.data.map((l) => l.id));
      cursor = p.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    const full = ((await pm.browser.get(`${path}?limit=200`)).json() as Page).data.map((l) => l.id);
    expect(seen).toEqual(full);
  });

  it('refuses a bad id, a bad date and anyone who is not an org owner or admin', async () => {
    const { pm, sub, path } = await setup();
    expect((await pm.browser.get(`${path}?projectId=nope`)).statusCode).toBe(422);
    expect((await pm.browser.get(`${path}?from=yesterday`)).statusCode).toBe(422);
    expect((await sub.browser.get(path)).statusCode).toBe(403);
  });

  it("never shows another company's events", async () => {
    const { path } = await setup();
    const other = await signUp(t.app, 'aud-other');
    const otherOrg = await createOrg(other.browser, 'Other Audit Co');
    const res = await other.browser.get(path.replace(/orgs\/[^/]+/, `orgs/${otherOrg.id}`));
    expect(res.statusCode).toBe(200);
    expect((res.json() as Page).data.every((l) => l.projectName !== 'Audit Alpha')).toBe(true);
    expect((await other.browser.get(path)).statusCode).toBeGreaterThanOrEqual(403);
  });
});
