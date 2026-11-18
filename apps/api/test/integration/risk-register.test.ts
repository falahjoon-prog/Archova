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

type Risk = {
  id: string;
  number: number;
  score: number;
  level: string;
  status: string;
  version: number;
};

describe('Project risk register', () => {
  it('numbers, scores, summarises and closes risks, and hides them from subcontractors', async () => {
    const pm = await signUp(t.app, 'risk-pm');
    const sub = await signUp(t.app, 'risk-sub');
    const org = await createOrg(pm.browser, 'Risk Builder');
    const project = await createProject(pm.browser, org.id, { name: 'Tower R', state: 'NSW' });
    const base = `/v1/orgs/${org.id}/projects/${project.id}`;
    await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sparky');

    const empty = (await pm.browser.get(`${base}/risks/summary`)).json();
    expect(empty).toMatchObject({ rag: null, open: 0 });

    const low = (
      await pm.browser.post(`${base}/risks`, {
        title: 'Late tiles',
        category: 'time',
        likelihood: 1,
        impact: 2,
      })
    ).json() as Risk;
    expect(low).toMatchObject({ number: 1, score: 2, level: 'low' });
    const high = (
      await pm.browser.post(`${base}/risks`, {
        title: 'Crane collapse',
        category: 'safety',
        likelihood: 3,
        impact: 5,
      })
    ).json() as Risk;
    expect(high).toMatchObject({ number: 2, level: 'high' });

    const list = (await pm.browser.get(`${base}/risks`)).json().data as Risk[];
    expect(list.map((r) => r.number)).toEqual([2, 1]);
    expect((await pm.browser.get(`${base}/risks/summary`)).json()).toMatchObject({
      rag: 'red',
      high: 1,
      open: 2,
    });

    const closed = await pm.browser.patch(
      `${base}/risks/${high.id}`,
      { status: 'closed' },
      { 'if-match': `"${high.version}"` },
    );
    expect(closed.json()).toMatchObject({ status: 'closed', closedAt: expect.any(String) });
    expect((await pm.browser.get(`${base}/risks/summary`)).json()).toMatchObject({
      rag: 'green',
      high: 0,
      open: 1,
    });

    const stale = await pm.browser.patch(
      `${base}/risks/${high.id}`,
      { title: 'x' },
      { 'if-match': `"${high.version}"` },
    );
    expect(stale.statusCode).toBe(412);

    expect((await sub.browser.get(`${base}/risks`)).statusCode).toBe(403);

    expect((await pm.browser.del(`${base}/risks/${low.id}`)).statusCode).toBe(204);
    expect(((await pm.browser.get(`${base}/risks`)).json().data as Risk[]).length).toBe(1);
  });
});
