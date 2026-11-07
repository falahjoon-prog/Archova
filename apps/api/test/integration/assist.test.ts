import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createProject, createTestContext, signUp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

async function setup(label: string) {
  const pm = await signUp(t.app, `${label}-pm`);
  const org = await createOrg(pm.browser, `${label} Builders`);
  const project = await createProject(pm.browser, org.id, { name: 'Tower N', state: 'QLD' });
  return { pm, base: `/v1/orgs/${org.id}/projects/${project.id}` };
}

describe('POST /ai/assist (the Nova panel with tools)', () => {
  it('plans a lookup from the question, runs it as the caller and cites what it found', async () => {
    const s = await setup('assist-a');
    const res = await s.pm.browser.post(`${s.base}/ai/assist`, {
      question: 'What is running behind on the programme?',
      context: { screen: 'programme' },
      history: [],
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.lookups.map((l: { tool: string }) => l.tool)).toEqual(['late_programme_tasks']);
    expect(body.found).toBe(true);
    expect(body.citations[0].sourceType).toBe('programme');
    expect(body.citations[0].title).toBe('Late programme tasks');
  });

  it('reads the open record from the context for "this"', async () => {
    const s = await setup('assist-b');
    const res = await s.pm.browser.post(`${s.base}/ai/assist`, {
      question: "What's the status of this?",
      context: {
        screen: 'rfi',
        record: { type: 'rfi', id: 'rfi_notarealidnotarealid', label: 'RFI-001' },
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    // The id is not a real RFI id: the tool declines it, so nothing is made up.
    expect(res.json().found).toBe(false);
  });

  it('says so, without a model answer, when no lookup finds anything', async () => {
    const s = await setup('assist-c');
    const res = await s.pm.browser.post(`${s.base}/ai/assist`, {
      question: 'What colour is the lobby tile?',
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.found).toBe(false);
    expect(body.runId).toBeNull();
    expect(body.citations).toEqual([]);
  });

  it('rejects an empty question and anyone who cannot use Nova on the project', async () => {
    const s = await setup('assist-d');
    expect((await s.pm.browser.post(`${s.base}/ai/assist`, { question: '' })).statusCode).toBe(400);
    const stranger = await signUp(t.app, 'assist-d-stranger');
    const res = await stranger.browser.post(`${s.base}/ai/assist`, {
      question: 'Anything overdue?',
    });
    expect([403, 404]).toContain(res.statusCode);
  });
});
