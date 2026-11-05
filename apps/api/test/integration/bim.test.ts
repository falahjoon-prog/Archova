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
  const pm = await signUp(t.app, 'bim-pm');
  const sub = await signUp(t.app, 'bim-sub');
  const org = await createOrg(pm.browser, 'Coordination Builder');
  const project = await createProject(pm.browser, org.id, { name: 'Tower C', state: 'VIC' });
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sparky');
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  return { pm, sub, base };
}
const ifMatch = (version: number) => ({ 'if-match': `"${version}"` });

describe('design coordination', () => {
  it('registers models and retires the one a new issue supersedes', async () => {
    const { pm, sub, base } = await setup();
    const a = await pm.browser.post(`${base}/bim-models`, {
      name: 'Structure',
      discipline: 'structural',
      versionLabel: 'Rev A',
    });
    expect(a.statusCode).toBe(201);
    const first = a.json() as { id: string; status: string };
    expect(first.status).toBe('current');
    const b = await pm.browser.post(`${base}/bim-models`, {
      name: 'Structure',
      discipline: 'structural',
      versionLabel: 'Rev B',
      supersedesModelId: first.id,
    });
    expect(b.statusCode).toBe(201);
    const list = (await pm.browser.get(`${base}/bim-models`)).json().data as {
      id: string;
      status: string;
      supersededById: string | null;
    }[];
    expect(list).toHaveLength(2);
    expect(list.find((m) => m.id === first.id)).toMatchObject({
      status: 'superseded',
      supersededById: b.json().id,
    });
    // Superseding twice is refused, and a subcontractor has no access to the tool.
    const again = await pm.browser.post(`${base}/bim-models`, {
      name: 'Structure',
      discipline: 'structural',
      supersedesModelId: first.id,
    });
    expect(again.statusCode).toBe(422);
    expect((await sub.browser.get(`${base}/bim-models`)).statusCode).toBe(403);
  });

  it('raises, comments on, links and moves an issue along', async () => {
    const { pm, base } = await setup();
    const model = (
      await pm.browser.post(`${base}/bim-models`, { name: 'Services', discipline: 'mechanical' })
    ).json() as { id: string };
    const rfi = (
      await pm.browser.post(`${base}/rfis`, {
        subject: 'Duct clash at grid C4',
        question: 'The duct and the beam occupy the same space. Which moves?',
      })
    ).json().rfi as { id: string };

    const made = await pm.browser.post(`${base}/coordination-issues`, {
      title: 'Duct clashes with beam B12',
      priority: 'high',
      modelId: model.id,
      elementGuids: [' 3cUkl32yn9qRSPvBJVyWYp ', '3cUkl32yn9qRSPvBJVyWYp'],
      location: 'Level 2, grid C4',
      rfiId: rfi.id,
    });
    expect(made.statusCode).toBe(201);
    const issue = made.json().issue as { id: string; number: number; version: number };
    expect(issue).toMatchObject({
      number: 1,
      status: 'open',
      priority: 'high',
      elementGuids: ['3cUkl32yn9qRSPvBJVyWYp'],
      rfiId: rfi.id,
    });

    const second = await pm.browser.post(`${base}/coordination-issues`, { title: 'Second clash' });
    expect(second.json().issue.number).toBe(2);

    // An RFI id from nowhere is refused.
    const bad = await pm.browser.post(`${base}/coordination-issues`, {
      title: 'Bad link',
      rfiId: 'rfi_00000000000000000000000000',
    });
    expect(bad.statusCode).toBe(422);

    const commented = await pm.browser.post(`${base}/coordination-issues/${issue.id}/comments`, {
      body: 'Raised with the mechanical consultant.',
    });
    expect(commented.statusCode).toBe(201);
    expect(commented.json().issue.commentCount).toBe(1);

    const moved = await pm.browser.patch(
      `${base}/coordination-issues/${issue.id}`,
      { status: 'in_progress' },
      ifMatch(issue.version),
    );
    expect(moved.statusCode).toBe(200);
    const v2 = moved.json().issue.version as number;
    // A stale version is refused; so is a move the lifecycle does not allow.
    expect(
      (
        await pm.browser.patch(
          `${base}/coordination-issues/${issue.id}`,
          { priority: 'low' },
          ifMatch(issue.version),
        )
      ).statusCode,
    ).toBe(412);
    const resolved = await pm.browser.patch(
      `${base}/coordination-issues/${issue.id}`,
      { status: 'resolved' },
      ifMatch(v2),
    );
    expect(resolved.json().issue.resolvedAt).not.toBeNull();
    const reopened = await pm.browser.patch(
      `${base}/coordination-issues/${issue.id}`,
      { status: 'in_progress' },
      ifMatch(resolved.json().issue.version),
    );
    expect(reopened.statusCode).toBe(409);
    expect(reopened.json().code).toBe('bim.invalid_transition');

    const open = (await pm.browser.get(`${base}/coordination-issues?status=open`)).json().data as {
      number: number;
    }[];
    expect(open.map((i) => i.number)).toEqual([2]);
    const found = (await pm.browser.get(`${base}/coordination-issues?q=duct`)).json().data as {
      number: number;
    }[];
    expect(found.map((i) => i.number)).toEqual([1]);
    const detail = await pm.browser.get(`${base}/coordination-issues/${issue.id}`);
    expect(detail.json().comments).toHaveLength(1);
  });
});
