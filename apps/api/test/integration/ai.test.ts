import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CitationSchema, definePrompt, z } from '@archova/ai-prompts';
import { decodeId, encodeId } from '@archova/domain';
import { createLogger, type TenantContext } from '@archova/kernel';
import { FAKE_MODELS, ProviderError, createAiModule, type AiApi } from '@archova/mod-ai';
import { TRIAL_ENTITLEMENTS } from '@archova/mod-billing';
import { createOrg, createTestContext, signUp, type TestContext } from './helpers';

let t: TestContext;
let nova: AiApi;
beforeAll(async () => {
  t = await createTestContext();
  nova = createAiModule(
    { database: t.database, redis: t.redis, logger: createLogger('test', 'silent') },
    {
      config: { provider: { kind: 'fake' }, models: FAKE_MODELS },
      // New orgs default to Sydney; the app's own module reads the org's zone from platform.
      orgTimeZone: async () => 'Australia/Sydney',
      readFile: async () => {
        throw new Error('not used');
      },
      assert: async () => undefined,
      sources: async () => [],
      accessScopes: async () => [],
      similarRfis: async () => [],
      getDrawingRevision: async () => {
        throw new Error('unused');
      },
      getPreviousDrawingRevision: async () => null,
      getMarkup: async () => ({ shapes: [] }),
      dayForSummary: async () => null,
      projectCompanies: async () => [],
      openDefectsNear: async () => [],
      quotePackage: async () => {
        throw new Error('not used');
      },
      openRfisOnDrawing: async () => [],
      provider: t.ai,
    },
  ).api;
});
afterAll(() => t.close());

const ask = definePrompt({
  id: 'qa.answer',
  version: 1,
  feature: 'ask',
  kind: 'interactive',
  tier: 'standard',
  system: 'Answer from the passages and cite them.',
  input: z.object({ question: z.string() }),
  output: z.object({ answer: z.string(), citations: z.array(CitationSchema) }),
  render: (i) => ({ text: i.question }),
  maxOutputTokens: 500,
  citations: (o) => o.citations,
});

const titleblock = definePrompt({
  id: 'drawing.titleblock',
  version: 1,
  feature: 'drawing_register',
  kind: 'background',
  tier: 'fast',
  system: 'Read the title block.',
  input: z.object({ sheet: z.string() }),
  output: z.object({ number: z.string() }),
  render: (i) => ({ text: i.sheet }),
  maxOutputTokens: 200,
});

const passages = [
  {
    id: 'p1',
    source: { type: 'spec_section', id: 'spec-0431', title: 'Spec 0431' },
    text: 'Membranes extend 150 mm up walls.',
  },
];

async function newOrg(label: string) {
  const { browser, userId } = await signUp(t.app, label);
  const org = await createOrg(browser, `${label} Builders`);
  const ctx: TenantContext = {
    orgId: decodeId('org', org.id)!,
    userId: decodeId('user', userId)!,
    principalType: 'member',
    orgRole: 'owner',
    entitlements: TRIAL_ENTITLEMENTS,
    requestId: 'test',
  };
  return { browser, org, ctx };
}

const answered = () => ({
  output: { answer: '150 mm', citations: [{ passageId: 'p1', quote: '150 mm up walls' }] },
});

describe('Nova gateway (ai/03)', () => {
  it('runs a task, checks citations, logs the call and charges one credit to the org', async () => {
    t.ai.on('qa.answer', answered);
    const { browser, org, ctx } = await newOrg('nova');
    const run = await nova.runTask(ctx, ask, { question: 'How high?' }, { passages });
    expect(run).toMatchObject({ status: 'ok', credits: 1, tier: 'standard', fallback: false });
    if (run.status !== 'ok') throw new Error();
    expect(run.citations).toEqual([expect.objectContaining({ passageId: 'p1' })]);

    const rows = await t.database.withTenantTx(ctx, (s) =>
      s.tx.execute(
        sql`select task, feature, provider, model, outcome, credits::float as credits, cost_micros from ai.ai_requests where run_id = ${run.runId}`,
      ),
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({
        task: 'qa.answer',
        feature: 'ask',
        provider: 'fake',
        model: 'fake-standard',
        outcome: 'ok',
        credits: 1,
      }),
    ]);

    const usage = await browser.get(`/v1/orgs/${org.id}/ai/usage`);
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({
      timezone: 'Australia/Sydney',
      allowance: null,
      used: 1,
      byFeature: [{ feature: 'ask', credits: 1, runs: 1 }],
    });

    // Feedback from the person who asked; anyone else gets a 404.
    const runPath = `/v1/orgs/${org.id}/ai/runs/${encodeId('aiRun', run.runId)}/feedback`;
    const fb = await browser.request('PUT', runPath, { rating: 'down', reason: 'wrong_source' });
    expect(fb.statusCode).toBe(204);
    const again = await browser.request('PUT', runPath, { rating: 'up' });
    expect(again.statusCode).toBe(204);
    const other = await newOrg('nova-other');
    const foreign = await other.browser.request(
      'PUT',
      `/v1/orgs/${other.org.id}/ai/runs/${encodeId('aiRun', run.runId)}/feedback`,
      { rating: 'up' },
    );
    expect(foreign.statusCode).toBe(404);
    const otherUsage = await other.browser.get(`/v1/orgs/${other.org.id}/ai/usage`);
    expect(otherUsage.json()).toMatchObject({ used: 0, byFeature: [] });
  });

  it('records every attempt and charges nothing when the run fails or is refused', async () => {
    const { ctx } = await newOrg('nova-fail');
    t.ai.on('qa.answer', () => {
      throw new ProviderError('unavailable', 'down');
    });
    await expect(nova.runTask(ctx, ask, { question: 'q' }, { passages })).rejects.toMatchObject({
      code: 'ai.unavailable',
    });
    t.ai.on('qa.answer', () => ({ text: '', stop: 'refusal' }));
    const refused = await nova.runTask(ctx, ask, { question: 'q' }, { passages });
    expect(refused).toMatchObject({ status: 'refused', credits: 0 });

    const rows = await t.database.withTenantTx(ctx, (s) =>
      s.tx.execute(
        sql`select tier, outcome, error_kind from ai.ai_requests order by created_at, attempt`,
      ),
    );
    expect(rows.rows).toEqual([
      { tier: 'standard', outcome: 'error', error_kind: 'unavailable' },
      { tier: 'standard', outcome: 'error', error_kind: 'unavailable' },
      { tier: 'fast', outcome: 'error', error_kind: 'unavailable' },
      { tier: 'fast', outcome: 'error', error_kind: 'unavailable' },
      { tier: 'standard', outcome: 'refused', error_kind: null },
    ]);
    const ledger = await t.database.withTenantTx(ctx, (s) =>
      s.tx.execute(sql`select credits::float as credits, runs from ai.ai_usage_ledger`),
    );
    expect(ledger.rows).toEqual([{ credits: 0, runs: 2 }]);
  });

  it('applies org settings: features off, AI off, and the monthly cap for interactive work only', async () => {
    t.ai.on('qa.answer', answered);
    t.ai.on('drawing.titleblock', () => ({ output: { number: 'A-201' } }));
    const { browser, org, ctx } = await newOrg('nova-settings');
    const url = `/v1/orgs/${org.id}/ai/settings`;

    const initial = await browser.get(url);
    expect(initial.statusCode).toBe(200);
    expect(initial.headers.etag).toBe('"0"');
    expect(initial.json()).toEqual({
      aiEnabled: true,
      featuresEnabled: null,
      monthlyCreditCap: null,
      externalAiEnabled: true,
      retentionDays: 30,
      version: 0,
    });

    const capped = await browser.patch(url, { monthlyCreditCap: 1 }, { 'if-match': '"0"' });
    expect(capped.statusCode).toBe(200);
    expect(capped.headers.etag).toBe('"1"');
    const stale = await browser.patch(url, { retentionDays: 7 }, { 'if-match': '"0"' });
    expect(stale.statusCode).toBe(412);

    await nova.runTask(ctx, ask, { question: 'q' }, { passages });
    await expect(nova.runTask(ctx, ask, { question: 'q' }, { passages })).rejects.toMatchObject({
      code: 'ai.allowance_used',
    });
    // Background work that keeps the register correct is never stopped by credits (ai/05 §4).
    const tb = await nova.runTask(ctx, titleblock, { sheet: 'A-201' });
    expect(tb).toMatchObject({ status: 'ok', credits: 0 });
    const usage = await browser.get(`/v1/orgs/${org.id}/ai/usage`);
    expect(usage.json()).toMatchObject({ allowance: 1, used: 1, remaining: 0 });

    await browser.patch(url, { featuresEnabled: ['ask'] }, { 'if-match': '"1"' });
    await expect(nova.runTask(ctx, titleblock, { sheet: 'A-201' })).rejects.toMatchObject({
      code: 'ai.feature_disabled',
    });

    await browser.patch(url, { aiEnabled: false }, { 'if-match': '"2"' });
    await expect(nova.runTask(ctx, ask, { question: 'q' }, { passages })).rejects.toMatchObject({
      code: 'ai.disabled',
    });

    const invalid = await browser.patch(url, { retentionDays: 365 }, { 'if-match': '"3"' });
    expect(invalid.statusCode).toBe(422);
  });

  it("hides an org's Nova settings and usage from people outside it", async () => {
    const { browser, org } = await newOrg('nova-roles');
    const outsider = await signUp(t.app, 'nova-outsider');
    const res = await outsider.browser.get(`/v1/orgs/${org.id}/ai/settings`);
    expect(res.statusCode).toBe(404);
    const usage = await outsider.browser.get(`/v1/orgs/${org.id}/ai/usage`);
    expect(usage.statusCode).toBe(404);
    const own = await browser.get(`/v1/orgs/${org.id}/ai/settings`);
    expect(own.statusCode).toBe(200);
  });
});
