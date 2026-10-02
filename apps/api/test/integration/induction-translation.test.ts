import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeId, uuidv7 } from '@archova/domain';
import { createLogger, type TenantContext } from '@archova/kernel';
import {
  DEFAULT_FAKE_RESPONDERS,
  FAKE_MODELS,
  createAiModule,
  type AiApi,
  type InductionVersionContent,
  type TranslationLanguage,
} from '@archova/mod-ai';
import { TRIAL_ENTITLEMENTS } from '@archova/mod-billing';
import { createOrg, createProject, createTestContext, signUp, type TestContext } from './helpers';

// I4 (ai/12 §2): `workforce` doesn't exist yet, so these tests call the ai module API the way it will, with a stub
// induction version and a test language (no real language is enabled until it is reviewed and its eval passes).
const TEST_LANGUAGE: TranslationLanguage = {
  code: 'x-test',
  name: 'Testish',
  nativeName: 'Testish',
  enabled: true,
  labels: {
    label:
      'Machine translation for understanding (Testish). The English version is the official one.',
    keptInEnglish: 'This part is in English. Ask your supervisor (Testish).',
  },
  glossary: { version: 3, terms: [{ en: 'assembly point', target: 'gathering place' }] },
};

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
      sources: async () => [],
      accessScopes: async () => [],
      similarRfis: async () => [],
      getDrawingRevision: async () => {
        throw new Error('unused');
      },
      getPreviousDrawingRevision: async () => null,
      openRfisOnDrawing: async () => [],
      provider: t.ai,
      translationLanguages: [TEST_LANGUAGE, { ...TEST_LANGUAGE, code: 'x-off', enabled: false }],
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
  return { browser, org, projectId: decodeId('project', project.id)!, ctx };
}

const version = (projectId: string): InductionVersionContent => ({
  inductionId: uuidv7(),
  versionId: uuidv7(),
  projectId,
  version: 1,
  slides: [
    {
      title: 'Emergencies',
      points: [
        'On the siren, walk to the assembly point at the oval.',
        'Call 000 and give 5 Riverbend Drive.',
      ],
      script: ['Site manager: Priscilla Tan, mobile 0434 555 661.'],
    },
    {
      title: 'First aid',
      points: ['The defibrillator is in the site office.'],
      script: [],
    },
  ],
  quiz: [
    { id: 'q1', question: 'Where is the assembly point?', options: ['The oval', 'The car park'] },
  ],
});

describe('Nova induction translation (I4)', () => {
  it('translates with numbers kept, leaves a failing slide in English, and caches per version and language', async () => {
    const { browser, org, projectId, ctx } = await newProject('ind-tr');
    const v = version(projectId);

    expect(nova.translationLanguages()).toEqual([
      { code: 'x-test', name: 'Testish', nativeName: 'Testish' },
    ]);
    for (const code of ['x-off', 'vi', 'xx'])
      await expect(nova.translateInduction(ctx, v, code)).rejects.toMatchObject({
        code: 'ai.translation.language_unavailable',
      });

    // The model drops a placeholder on the first-aid slide: that slide must stay in English.
    const translate = DEFAULT_FAKE_RESPONDERS['translation.translate']!;
    let glossarySeen = '';
    t.ai.on('translation.translate', async (req) => {
      if (req.text.includes('assembly point')) glossarySeen = req.text;
      const reply = await translate(req);
      if (!req.text.includes('defibrillator') || !('output' in reply)) return reply;
      const output = reply.output as { items: Array<{ id: string; text: string }> };
      return {
        output: { items: output.items.map((i) => ({ ...i, text: 'dropped the details' })) },
      };
    });

    const before = t.ai.calls.length;
    const tr = await nova.translateInduction(ctx, v, 'x-test');
    expect(tr).toMatchObject({
      language: 'x-test',
      label: TEST_LANGUAGE.labels!.label,
      keptInEnglish: TEST_LANGUAGE.labels!.keptInEnglish,
      versionId: v.versionId,
      glossaryVersion: 3,
      translationHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(glossarySeen).toContain('assembly point = gathering place');
    const [emergencies, firstAid] = tr.slides;
    expect(emergencies).toMatchObject({ slide: 1, translated: true });
    // Protected spans come back exactly as written.
    expect(emergencies!.points[1]).toBe('«Testish» Call 000 and give 5 Riverbend Drive.');
    expect(emergencies!.script[0]).toContain('0434 555 661');
    expect(firstAid).toEqual({
      slide: 2,
      translated: false,
      title: 'First aid',
      points: ['The defibrillator is in the site office.'],
      script: [],
    });
    expect(tr.quiz).toEqual([
      {
        id: 'q1',
        translated: true,
        question: '«Testish» Where is the assembly point?',
        options: ['«Testish» The oval', '«Testish» The car park'],
      },
    ]);
    expect(tr.backTranslationScore).toBeCloseTo(2 / 3);

    // Cached: the second worker gets the same translation with no model call.
    const calls = t.ai.calls.length;
    expect(calls).toBeGreaterThan(before);
    expect(await nova.translateInduction(ctx, v, 'x-test')).toEqual(tr);
    expect(t.ai.calls.length).toBe(calls);

    // A new English version is translated afresh.
    const edited = { ...v, slides: [{ ...v.slides[0]!, title: 'Emergency procedures' }] };
    const tr2 = await nova.translateInduction(ctx, edited, 'x-test');
    expect(tr2.slides[0]!.title).toBe('«Testish» Emergency procedures');
    expect(tr2.translationHash).not.toBe(tr.translationHash);

    // The meaning check failing keeps that slide in English too.
    t.ai.on('translation.translate', translate);
    t.ai.on('translation.check', async (req) => ({
      output: {
        items: [...req.text.matchAll(/^\[([^\]]+)\]$/gm)].map((m) => ({
          id: m[1]!,
          backTranslation: 'Hard hats are optional.',
          meaningPreserved: false,
          issue: 'Says hard hats are optional.',
        })),
      },
    }));
    const other = await newProject('ind-tr-check');
    const failed = await nova.translateInduction(other.ctx, version(other.projectId), 'x-test');
    expect(failed.slides.every((s) => !s.translated)).toBe(true);
    expect(failed.backTranslationScore).toBe(0);
    t.ai.on('translation.check', DEFAULT_FAKE_RESPONDERS['translation.check']!);

    // Charged under inductions: 0.25 a slide or question translated, the check is free.
    const usage = (await browser.get(`/v1/orgs/${org.id}/ai/usage`)).json();
    expect(usage.byFeature).toEqual(
      expect.arrayContaining([expect.objectContaining({ feature: 'inductions', credits: 1.25 })]),
    );
  });
});
