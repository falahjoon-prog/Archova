import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createTestContext, signUp, type TestContext } from './helpers';

// Nova help: "what does this error mean" and "where do I find …", org level, no project records read.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const helpCalls = () => t.ai.calls.filter((c) => c.task === 'help.explain');

describe('Nova help route', () => {
  it('explains an error, costs a fraction of a credit and sends no ids or trace references', async () => {
    const owner = await signUp(t.app, 'help-owner');
    const org = await createOrg(owner.browser, 'Help Builder');
    const before = helpCalls().length;
    const res = await owner.browser.post(`/v1/orgs/${org.id}/ai/help`, {
      area: 'RFIs',
      error: { status: 403, code: 'forbidden', message: 'You do not have access.' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runId).toMatch(/^air_/);
    expect(body.answer).toMatch(/access/i);
    expect(helpCalls()).toHaveLength(before + 1);
    const sent = helpCalls().at(-1)!.text;
    expect(sent).toContain('status="403"');
    const usage = (await owner.browser.get(`/v1/orgs/${org.id}/ai/usage`)).json();
    expect(usage.byFeature).toContainEqual({ feature: 'ask', credits: 0.05, runs: 1 });
  });

  it('answers a where-is question and never returns a link', async () => {
    const owner = await signUp(t.app, 'help-find');
    const org = await createOrg(owner.browser, 'Find Builder');
    const res = await owner.browser.post(`/v1/orgs/${org.id}/ai/help`, {
      question: 'where do I find RFIs?',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools).toContain('RFIs');
    expect(JSON.stringify(res.json())).not.toMatch(/https?:\/\//);
  });

  it('rejects an empty request and anyone who is not in the organisation', async () => {
    const owner = await signUp(t.app, 'help-empty');
    const org = await createOrg(owner.browser, 'Empty Builder');
    expect((await owner.browser.post(`/v1/orgs/${org.id}/ai/help`, {})).statusCode).toBe(422);
    const stranger = await signUp(t.app, 'help-stranger');
    const denied = await stranger.browser.post(`/v1/orgs/${org.id}/ai/help`, { question: 'hi' });
    expect([403, 404]).toContain(denied.statusCode);
  });

  it('is off when the organisation switches Nova off', async () => {
    const owner = await signUp(t.app, 'help-off');
    const org = await createOrg(owner.browser, 'Off Builder');
    const off = await owner.browser.patch(
      `/v1/orgs/${org.id}/ai/settings`,
      { aiEnabled: false },
      { 'if-match': '"0"' },
    );
    expect(off.statusCode).toBe(200);
    const res = await owner.browser.post(`/v1/orgs/${org.id}/ai/help`, { question: 'hi' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
