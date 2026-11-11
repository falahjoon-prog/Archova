import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  type TestContext,
} from './helpers';

// Project home Insights card: ranked notes from the real rfis module, and Nova's read-only follow-up through ai.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

type Note = { id: string; severity: string; title: string; facts: string[] };
const discussCalls = () => t.ai.calls.filter((c) => c.task === 'insights.discuss');

async function setup(label: string, opts: { overdueRfi: boolean }) {
  const pm = await signUp(t.app, `${label}-pm`);
  const sub = await signUp(t.app, `${label}-sub`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Wharf St', state: 'QLD' });
  await addMember(pm.browser, org.id, project.id, sub.email, 'Subcontractor', 'Sparky');
  const base = `/v1/orgs/${org.id}/projects/${project.id}`;
  if (opts.overdueRfi) {
    const draft = await pm.browser.post(`${base}/rfis`, {
      subject: 'Slab edge detail',
      question: 'Which detail governs?',
      assigneeIds: [pm.userId],
      dueDate: '2020-01-10',
    });
    expect(draft.statusCode).toBe(201);
    const opened = await pm.browser.post(`${base}/rfis/${draft.json().rfi.id}/open`, undefined, {
      'if-match': draft.headers.etag as string,
    });
    expect(opened.statusCode).toBe(200);
  }
  return { pm, sub, base };
}

describe('GET /projects/{projectId}/insights', () => {
  it('lists an overdue RFI as a note with the figures behind it', async () => {
    const s = await setup('ins-a', { overdueRfi: true });
    const res = await s.pm.browser.get(`${s.base}/insights`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { projectName: string; insights: Note[] };
    expect(body.projectName).toBe('Wharf St');
    expect(body.insights).toHaveLength(1);
    expect(body.insights[0]).toMatchObject({ id: 'rfis', severity: 'low' });
    expect(body.insights[0]!.facts).toEqual(['Open RFIs: 1', 'Overdue RFIs: 1']);
  });

  it('returns an empty list for a project with nothing to flag', async () => {
    const s = await setup('ins-b', { overdueRfi: false });
    const res = await s.pm.browser.get(`${s.base}/insights`);
    expect(res.statusCode).toBe(200);
    expect(res.json().insights).toEqual([]);
  });

  it('is staff only', async () => {
    const s = await setup('ins-c', { overdueRfi: true });
    expect((await s.sub.browser.get(`${s.base}/insights`)).statusCode).toBe(403);
  });
});

describe('POST /projects/{projectId}/insights/discuss', () => {
  it('answers from the notes, drops invented figures, and always asks for review', async () => {
    const s = await setup('ins-d', { overdueRfi: true });
    t.ai.on('insights.discuss', () => ({
      output: {
        sentences: [
          { text: '1 of the 1 open RFIs is overdue.', sources: ['rfis.1', 'rfis.2'] },
          { text: 'There are 40 overdue RFIs.', sources: ['rfis.2'] },
        ],
        options: [{ text: 'Consider chasing the assignee.', sources: ['rfis.2'] }],
      },
    }));
    const before = discussCalls().length;
    const res = await s.pm.browser.post(`${s.base}/insights/discuss`, {
      question: 'Why is this flagged?',
      insightId: 'rfis',
      history: [],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      grounded: true,
      answer: '1 of the 1 open RFIs is overdue.',
      suggestions: ['Consider chasing the assignee.'],
      reviewRequired: true,
    });
    expect(discussCalls()).toHaveLength(before + 1);
  });

  it('does not call the model when there is nothing to discuss', async () => {
    const s = await setup('ins-e', { overdueRfi: false });
    const before = discussCalls().length;
    const res = await s.pm.browser.post(`${s.base}/insights/discuss`, {
      question: 'Anything I should know?',
      history: [],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ runId: null, grounded: false, reviewRequired: true });
    expect(discussCalls()).toHaveLength(before);
  });

  it('is staff only', async () => {
    const s = await setup('ins-f', { overdueRfi: true });
    const res = await s.sub.browser.post(`${s.base}/insights/discuss`, {
      question: 'Why?',
      history: [],
    });
    expect([403, 404]).toContain(res.statusCode);
  });
});
