import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

// My Work: due items across projects, narrowed to what the caller can open, and per-person bookmarks.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Item = { project: string; ref: string; bucket: string | null; dueDate: string | null };
type MyWork = {
  counts: { overdue: number; today: number; next7: number };
  items: Item[];
  recent: Item[];
  bookmarks: Array<{ id: string; label: string; path: string; projectId: string | null }>;
  restrictedProjects: number;
};

async function openRfi(
  pm: Awaited<ReturnType<typeof signUp>>,
  base: string,
  subject: string,
  dueDate: string,
) {
  const draft = await pm.browser.post(`${base}/rfis`, {
    subject,
    question: 'Which detail governs?',
    assigneeIds: [pm.userId],
    dueDate,
  });
  expect(draft.statusCode).toBe(201);
  const opened = await pm.browser.post(`${base}/rfis/${draft.json().rfi.id}/open`, undefined, {
    'if-match': draft.headers.etag as string,
  });
  expect(opened.statusCode).toBe(200);
}

async function setup(tag: string) {
  const pm = await signUp(t.app, `${tag}-pm`);
  const other = await signUp(t.app, `${tag}-other`);
  const org = await createOrg(pm.browser, `My Work ${tag} Co`);
  const a = await createProject(pm.browser, org.id, { name: 'Alpha Tower', state: 'QLD' });
  const b = await createProject(pm.browser, org.id, { name: 'Bravo Lofts', state: 'QLD' });
  const baseA = `/v1/orgs/${org.id}/projects/${a.id}`;
  const baseB = `/v1/orgs/${org.id}/projects/${b.id}`;
  await addMember(pm.browser, org.id, a.id, other.email, 'Subcontractor', 'Sparky');
  await openRfi(pm, baseA, 'Slab edge detail', '2020-01-10'); // overdue
  await openRfi(pm, baseA, 'Balustrade height', '2099-01-10'); // not due for a long time
  await openRfi(pm, baseB, 'Stair nosing', '2020-03-01'); // overdue, other project
  return { pm, other, org, a, b, root: `/v1/orgs/${org.id}/my-work` };
}

describe('My Work', () => {
  it('lists what is overdue across every project the caller can open, most urgent first', async () => {
    const s = await setup('mw1');
    const res = await s.pm.browser.get(s.root);
    expect(res.statusCode).toBe(200);
    const w = res.json() as MyWork;
    expect(w.counts).toMatchObject({ overdue: 2, today: 0, next7: 0 });
    expect(w.items.map((i) => [i.project, i.bucket])).toEqual([
      ['Alpha Tower', 'overdue'],
      ['Bravo Lofts', 'overdue'],
    ]);
    expect(w.items[0]!.dueDate).toBe('2020-01-10');
    expect(w.restrictedProjects).toBe(0);
  });

  it('is staff only', async () => {
    const s = await setup('mw2');
    expect((await s.other.browser.get(s.root)).statusCode).toBe(403);
  });

  it('saves bookmarks per person: idempotent on path, private, removable, in-app paths only', async () => {
    const s = await setup('mw3');
    const body = { label: 'Alpha RFIs', path: '/my-work-co/projects/x/rfis', projectId: s.a.id };
    const first = await s.pm.browser.post(`${s.root}/bookmarks`, body);
    expect(first.statusCode).toBe(201);
    const again = await s.pm.browser.post(`${s.root}/bookmarks`, body);
    expect(again.json().id).toBe(first.json().id);

    const w = (await s.pm.browser.get(s.root)).json() as MyWork;
    expect(w.bookmarks).toHaveLength(1);
    expect(w.bookmarks[0]).toMatchObject({ label: 'Alpha RFIs', projectId: s.a.id });

    for (const path of ['//evil.example', 'https://evil.example', 'javascript:alert(1)']) {
      const bad = await s.pm.browser.post(`${s.root}/bookmarks`, { label: 'x', path });
      expect(bad.statusCode).toBe(422);
    }

    expect((await s.pm.browser.del(`${s.root}/bookmarks/${first.json().id}`)).statusCode).toBe(204);
    expect((await s.pm.browser.del(`${s.root}/bookmarks/${first.json().id}`)).statusCode).toBe(404);
    expect(((await s.pm.browser.get(s.root)).json() as MyWork).bookmarks).toHaveLength(0);
  });
});
