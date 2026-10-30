import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId, uuidv7 } from '@archova/domain';
import { createLogger, type TenantContext } from '@archova/kernel';
import {
  FAKE_MODELS,
  INDUCTION_ASK_SUPERVISOR,
  createAiModule,
  type AiApi,
  type InductionVersionContent,
} from '@archova/mod-ai';
import { TRIAL_ENTITLEMENTS } from '@archova/mod-billing';
import { createOrg, createProject, createTestContext, signUp, type TestContext } from './helpers';

// I3 (ai/12 §2): `workforce` doesn't exist yet, so these tests call the ai module API the way it will, with a stub
// induction version.
let t: TestContext;
let nova: AiApi;
beforeAll(async () => {
  t = await createTestContext();
  nova = createAiModule(
    { database: t.database, redis: t.redis, logger: createLogger('test', 'silent') },
    {
      config: { provider: { kind: 'fake' }, models: FAKE_MODELS },
      orgTimeZone: async () => 'Australia/Sydney',
      readFile: async () => {
        throw new Error('not used');
      },
      assert: async () => undefined,
      can: async () => true,
      sources: async () => [],
      accessScopes: async () => [],
      rfiSources: async () => [],
      rfiAccessScopes: async () => [],
      defectSources: async () => [],
      defectAccessScopes: async () => [],
      diarySources: async () => [],
      diaryAccessScopes: async () => [],
      similarRfis: async () => [],
      rfiForAnswer: async () => {
        throw new Error('not used');
      },
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
      quoteForNegotiation: async () => {
        throw new Error('not used');
      },
      openRfisOnDrawing: async () => [],
      provider: t.ai,
    },
  ).api;
});
afterAll(() => t.close());

async function newProject(label: string) {
  const { browser, userId } = await signUp(t.app, label);
  const org = await createOrg(browser, `${label} Builders`);
  const project = await createProject(browser, org.id, { name: 'Riverbend', state: 'VIC' });
  const ctx: TenantContext = {
    orgId: decodeId('org', org.id)!,
    userId: decodeId('user', userId)!,
    principalType: 'member',
    orgRole: 'owner',
    entitlements: TRIAL_ENTITLEMENTS,
    requestId: 'test',
  };
  return { browser, org, project, projectId: decodeId('project', project.id)!, ctx };
}

function version(projectId: string, n: number, assembly: string): InductionVersionContent {
  return {
    inductionId: uuidv7(),
    versionId: uuidv7(),
    projectId,
    version: n,
    slides: [
      {
        title: 'Welcome and site contacts',
        points: ['Site manager: Priscilla Tan, mobile 0434 555 661.'],
        script: ['Sign in on the app at the main gate before you start work.'],
      },
      {
        title: 'Emergencies',
        points: [`On the continuous siren, stop work and walk to the assembly point ${assembly}.`],
        script: [
          'In an emergency call 000 and give the site address: 5 Riverbend Drive, Werribee.',
        ],
      },
      {
        title: 'Amenities',
        points: ['Toilets and the lunch room are in the site sheds next to the main gate.'],
        script: [],
      },
    ],
  };
}

describe('Nova induction Q&A (I3)', () => {
  it("answers only from that induction version's slides, and says ask your supervisor otherwise", async () => {
    const { browser, org, project, projectId, ctx } = await newProject('ind-qa');
    const v1 = version(projectId, 1, 'at the oval near the cricket nets');
    const v2 = version(projectId, 2, 'in the Hoppers Lane car park');

    expect(await nova.indexInductionVersion(ctx, v1)).toEqual({ indexed: true, chunks: 3 });
    expect(await nova.indexInductionVersion(ctx, v1)).toEqual({ indexed: false, chunks: 3 });
    await nova.indexInductionVersion(ctx, v2);

    const question = 'Where is the assembly point?';
    const a1 = await nova.askInduction(ctx, { projectId, versionId: v1.versionId, question });
    expect(a1).toMatchObject({ found: true, runId: expect.any(String) });
    expect(a1.answer).toContain('oval near the cricket nets');
    expect(a1.citations).toEqual([
      expect.objectContaining({ slide: 2, slideTitle: 'Emergencies' }),
    ]);
    // Each version answers from its own slides only.
    const a2 = await nova.askInduction(ctx, { projectId, versionId: v2.versionId, question });
    expect(a2.answer).toContain('Hoppers Lane car park');
    expect(JSON.stringify(a2)).not.toContain('cricket');

    // Not in the induction: ask your supervisor, never a guess.
    const wifi = await nova.askInduction(ctx, {
      projectId,
      versionId: v1.versionId,
      question: 'What is the wifi password?',
    });
    expect(wifi).toMatchObject({ found: false, answer: INDUCTION_ASK_SUPERVISOR, citations: [] });

    // Ask Nova on the project never retrieves induction slides.
    const projectAsk = await browser.post(`/v1/orgs/${org.id}/projects/${project.id}/ai/ask`, {
      question,
    });
    expect(projectAsk.statusCode).toBe(200);
    expect(projectAsk.json()).toMatchObject({ found: false, citations: [], closestMatches: [] });

    // Re-indexing the project's documents leaves the induction's chunks alone.
    expect(
      (await browser.post(`/v1/orgs/${org.id}/projects/${project.id}/ai/index`)).statusCode,
    ).toBe(200);
    const again = await nova.askInduction(ctx, { projectId, versionId: v1.versionId, question });
    expect(again.found).toBe(true);

    // A quarter credit per answered question, under inductions (four model calls above).
    const usage = (await browser.get(`/v1/orgs/${org.id}/ai/usage`)).json();
    expect(usage.byFeature).toEqual(
      expect.arrayContaining([expect.objectContaining({ feature: 'inductions', credits: 1 })]),
    );

    // Another org can't reach this induction, even with its version id: nothing is retrieved, no model call.
    const other = await newProject('ind-qa-other');
    const leaked = await nova.askInduction(other.ctx, {
      projectId,
      versionId: v1.versionId,
      question,
    });
    expect(leaked).toEqual({
      runId: null,
      found: false,
      answer: INDUCTION_ASK_SUPERVISOR,
      citations: [],
    });

    // Never indexed: same, with no model call.
    const unknown = await nova.askInduction(ctx, { projectId, versionId: uuidv7(), question });
    expect(unknown.runId).toBeNull();
  });
});
